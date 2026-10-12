import { frameChatChild } from "../messages/chat-frame.js";
import { turnHeadRows } from "../messages/message-meta.js";
import { GEEK_PREFIX_WIDTH, geekRow, geekSplitRow } from "../presentation/geek-rows.js";
import { geekFg } from "../theme/geek-palette.js";
import { nameColumn } from "./tool-call-line.js";
import { type TreeEntry, entryBodyRows, entryLine, renderToolTree } from "./tool-tree.js";
import {
	isEditClassTool,
	isToolComponent,
	isToolRunning,
	secondsText,
	toolElapsedMs,
	toolRail,
} from "./tool-summary.js";

/**
 * Folds a run of consecutive tool calls (and the text-less assistant turns that issued them)
 * into one summary row (docs/design/geek-ui-spec.md §4/§7). Grouping is a pure projection of
 * the chat children at render time: nothing is persisted. edit/write-class calls break a run
 * because they show their own diff rows; a run without any groupable call renders as before.
 */

/** Assistant turns with no visible answer text that issued tool calls belong to the tool run. */
function toolOnlyAssistantContent(component: any): any[] | null {
	const message = component?.lastMessage;
	if (message?.role !== "assistant" || !Array.isArray(message.content)) return null;
	if (message.stopReason === "error" || message.stopReason === "aborted") return null;
	const content = message.content as any[];
	if (content.some((block) => block?.type === "text" && typeof block.text === "string" && block.text.trim())) return null;
	return content.some((block) => block?.type === "toolCall") ? content : null;
}

function isGroupMember(component: any): boolean {
	return isToolComponent(component) ? !isEditClassTool(component.toolName) : toolOnlyAssistantContent(component) !== null;
}

const bold = (text: string) => `\x1b[1m${text}\x1b[22m`;
const dim = (text: string) => geekFg("dim", text);
const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/** `// 0.6s` (+ `running ·` for a lone running call); empty when there is nothing to say. */
function elapsedMeta(elapsedMs: number | undefined, running: boolean): string {
	const parts = [...(running ? [geekFg("accent", "running")] : []), ...(elapsedMs === undefined ? [] : [secondsText(elapsedMs)])];
	return parts.length > 0 ? `${dim("// ")}${parts.join(dim(" · "))}` : "";
}

/** `Done(3 tool calls · 1 thought · 1 failed)`; while running, `Running(… · <last running tool>)`. */
function headLeft(tools: any[], thoughts: number, failed: number, running: boolean): string {
	const parts = [dim(plural(tools.length, "tool call"))];
	if (thoughts > 0) parts.push(dim(plural(thoughts, "thought")));
	if (failed > 0) parts.push(geekFg("delMark", `${failed} failed`));
	const live = running ? tools.filter(isToolRunning).pop() : undefined;
	if (live) parts.push(geekFg("ink", live.toolName));
	return `${geekFg(running ? "accent" : "ink", bold(running ? "Running" : "Done"))}${dim("(")}${parts.join(dim(" · "))}${dim(")")}`;
}

function thoughtText(component: any): string {
	const content = toolOnlyAssistantContent(component) ?? [];
	return content
		.filter((block) => block?.type === "thinking" && typeof block.thinking === "string")
		.map((block) => block.thinking.trim())
		.filter(Boolean)
		.join(" ");
}

/**
 * One block for a run of tool calls (spec §4): a `Done(…)` / `Running(…)` head and one row per call
 * under `├─`/`└─` guides; a lone call is just its row (thoughts only show once expanded). Ctrl+O adds each call's output (and the
 * thoughts) under its guide. Folded assistant members are never rendered, so a turn-opening one hands
 * over its `pi@agent` head row, printed above the block.
 */
export function renderToolGroup(members: any[], width: number): string[] {
	const tools = members.filter(isToolComponent);
	const running = tools.some(isToolRunning);
	const expanded = tools.some((tool) => tool.expanded);
	const failed = tools.filter((tool) => Boolean(tool.result?.isError)).length;
	const thoughts = members.filter((member) => thoughtText(member)).length;
	let elapsedMs: number | undefined;
	for (const tool of tools) {
		const ms = toolElapsedMs(tool);
		if (ms !== undefined) elapsedMs = (elapsedMs ?? 0) + ms;
	}

	const rail = toolRail(tools);
	const bodyWidth = Math.max(1, width - GEEK_PREFIX_WIDTH);
	const hint = expanded ? "" : geekFg("faint", "^o  ");
	const rows = members.filter((member) => !isToolComponent(member)).flatMap((member) => turnHeadRows(member, width));

	if (tools.length === 1 && !(expanded && thoughts > 0)) {
		const entry: TreeEntry = { kind: "tool", tool: tools[0] };
		const line = entryLine(entry, nameColumn([tools[0].toolName]));
		rows.push(geekRow(rail, geekSplitRow(line, `${hint}${elapsedMeta(elapsedMs, running)}`.trimEnd(), bodyWidth), width));
		if (expanded) rows.push(...entryBodyRows(entry, width, rail, "  "));
	} else {
		const entries: TreeEntry[] = [];
		for (const member of members) {
			if (isToolComponent(member)) entries.push({ kind: "tool", tool: member });
			else if (expanded && thoughtText(member)) entries.push({ kind: "thought", text: thoughtText(member) });
		}
		const column = nameColumn([...tools.map((tool) => tool.toolName), ...(entries.some((entry) => entry.kind === "thought") ? ["thinking"] : [])]);
		rows.push(geekRow(rail, geekSplitRow(headLeft(tools, thoughts, failed, running), `${hint}${elapsedMeta(elapsedMs, false)}`.trimEnd(), bodyWidth), width));
		rows.push(...renderToolTree(entries, width, rail, expanded, column));
	}
	rows.push(geekRow("line", "", width));
	return rows;
}

function pushLines(target: string[], lines: string[]): void {
	for (let i = 0; i < lines.length; i++) target.push(lines[i]);
}

/** Renders chat children in order, folding tool runs into summary rows. */
export function renderChatChildren(children: any[], width: number): string[] {
	const lines: string[] = [];
	let index = 0;
	while (index < children.length) {
		let end = index;
		while (end < children.length && isGroupMember(children[end])) end++;
		if (end === index) {
			pushLines(lines, frameChatChild(children[index], width, children[index + 1], children[index - 1]));
			index++;
			continue;
		}
		const members = children.slice(index, end);
		const tools = members.filter(isToolComponent);
		if (tools.length === 0) {
			for (const member of members) pushLines(lines, member.render(width));
		} else {
			pushLines(lines, renderToolGroup(members, width));
		}
		index = end;
	}
	return lines;
}
