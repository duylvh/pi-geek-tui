import { turnHeadRows } from "../messages/message-meta.js";
import { GEEK_PREFIX_WIDTH, geekRow, geekSplitRow } from "../presentation/geek-rows.js";
import { geekFg } from "../theme/geek-palette.js";
import { renderToolTree, type TreeEntry } from "./tool-tree.js";
import {
	describeCall,
	isEditClassTool,
	isToolComponent,
	isToolRunning,
	secondsText,
	summarizeCalls,
	toolElapsedMs,
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

function thoughtText(component: any): string {
	const content = toolOnlyAssistantContent(component) ?? [];
	return content
		.filter((block) => block?.type === "thinking" && typeof block.thinking === "string")
		.map((block) => block.thinking.trim())
		.filter(Boolean)
		.join(" ");
}

function metaParts(callCount: number, thoughts: number, failed: number, running: boolean, elapsedMs: number | undefined): string {
	const dim = (text: string) => geekFg("dim", text);
	const parts = [dim(`${callCount} call`)];
	if (thoughts > 0) parts.push(dim(`${thoughts} thought`));
	if (failed > 0) parts.push(geekFg("delMark", `${failed} failed`));
	if (running) parts.push(geekFg("accent", "running"));
	if (elapsedMs !== undefined) parts.push(secondsText(elapsedMs));
	return `${dim("// ")}${parts.join(dim(" · "))}`;
}

/**
 * One block for a run of tool calls. Finished and collapsed: a single summary row (spec §4).
 * Running or expanded (Ctrl+O): the summary head plus a tree of calls (spec §7), with each
 * call's output under its node when expanded. Folded assistant members are never rendered, so a
 * turn-opening one hands over its `pi@agent` head row, printed above the group.
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

	const calls = summarizeCalls(tools.map((tool) => describeCall(tool.toolName, tool.args)));
	const left = `${geekFg(running ? "accent" : "ink", "› ")}${calls}`;
	const meta = metaParts(tools.length, thoughts, failed, running, elapsedMs);
	const tree = running || expanded;
	const right = tree ? meta : `${geekFg("faint", "^o  ")}${meta}`;
	const rail = running ? "active" : "line";
	const rows = [
		...members.filter((member) => !isToolComponent(member)).flatMap((member) => turnHeadRows(member, width)),
		geekRow(rail, geekSplitRow(left, right, Math.max(1, width - GEEK_PREFIX_WIDTH)), width),
	];
	if (tree) {
		const entries: TreeEntry[] = [];
		for (const member of members) {
			if (isToolComponent(member)) entries.push({ kind: "tool", tool: member });
			else if (thoughtText(member)) entries.push({ kind: "thought", text: thoughtText(member) });
		}
		rows.push(...renderToolTree(entries, width, rail, expanded));
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
			pushLines(lines, children[index].render(width));
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
