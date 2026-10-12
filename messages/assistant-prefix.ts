// Assistant rows (spec §2/§5): the first assistant message of a turn opens with the head row
// `• pi@agent ~/path (branch)`; every body row sits on the `┊` rail. Thinking runs collapse to
// one `thinking ▸ tail` row (config `collapsedThinking`).
import { AssistantMessageComponent } from "@earendil-works/pi-coding-agent";

import { loadConfig } from "../config.js";
import { GEEK_PREFIX_WIDTH, geekRow } from "../presentation/geek-rows.js";
import { safeTakeTailToWidth, safeVisibleWidth } from "../render-budget.js";
import { dropLeadingColumns, stripAnsi } from "../theme/ansi.js";
import { geekFg } from "../theme/geek-palette.js";
import { attachComponentToStream } from "./assistant-streaming-state.js";
import { type AssistantContentRun, getAssistantContentRuns } from "./assistant-content-runs.js";
import { markRailed } from "./chat-frame.js";
import { claimTurnHead, keepPromptZone, turnHeadRows } from "./message-meta.js";
import { revealBody } from "./reveal.js";

const PATCHED = Symbol.for("pi-geek-tui.assistant-prefix.patched");

/** Markdown/Text children are padded 1 column on each side; rows keep 1 spare cell on the right. */
function getAssistantBodyWidth(width: number): number {
	return Math.max(1, width - GEEK_PREFIX_WIDTH - 1);
}

function trimBlankEdges(lines: string[]): string[] {
	let first = 0;
	while (first < lines.length && stripAnsi(lines[first] ?? "").trim() === "") first++;
	let last = lines.length - 1;
	while (last >= first && stripAnsi(lines[last] ?? "").trim() === "") last--;
	return lines.slice(first, last + 1);
}

const COLLAPSED_TAIL_MIN_BUDGET = 16;
const THINKING_TAIL_LIVE_MARKER = "▸";
const THINKING_TAIL_SETTLED_MARKER = "·";
const THINKING_BLOCK_MARKER_PATTERN = /^(?:#{1,6}\s+|[-*+]\s+|\d+\.\s+|>\s?)/;

/** Last non-empty line of a thinking run, cleaned of a leading Markdown block marker and inner runs of whitespace. */
function cleanThinkingTailLine(text: string): string {
	return text.replace(/\s+/g, " ").trim().replace(THINKING_BLOCK_MARKER_PATTERN, "").trim();
}

function lastThinkingTailLine(text: string): string {
	const lines = text.split("\n");
	for (let i = lines.length - 1; i >= 0; i--) {
		const cleaned = cleanThinkingTailLine(lines[i] ?? "");
		if (cleaned) return cleaned;
	}
	return "";
}

/** The cut can land on whitespace; drop the space directly after the ellipsis (the row may end one column short). */
function trimTailWhitespaceAfterEllipsis(tail: string): string {
	if (!tail.startsWith("…")) return tail;
	return `…${tail.slice(1).replace(/^\s+/, "")}`;
}

/** The marker carries the progress state, so a label's own trailing progress dots would contradict `·`. */
function trimLabelProgressDots(label: string): string {
	return label.replace(/[.…\s]+$/u, "");
}

/** One collapsed row: ` <label> <marker> <tail>` at `bodyWidth`, or null when the tail budget is too small. */
function buildCollapsedThinkingRow(run: AssistantContentRun, label: string, live: boolean, bodyWidth: number): string | null {
	// bodyWidth - 1 (Text left padding) - label - 1 - marker - 1
	const tailBudget = bodyWidth - safeVisibleWidth(label) - 4;
	if (tailBudget < COLLAPSED_TAIL_MIN_BUDGET) return null;

	const tail = trimTailWhitespaceAfterEllipsis(safeTakeTailToWidth(lastThinkingTailLine(run.text), tailBudget));
	const marker = live ? geekFg("accent", THINKING_TAIL_LIVE_MARKER) : geekFg("faint", THINKING_TAIL_SETTLED_MARKER);
	// Spec strings are lowercase (`thinking ▸ …`), whatever casing Pi's hidden-thinking label uses.
	return ` ${geekFg("dim", label.toLowerCase())} ${marker} ${geekFg("faint", tail)}`;
}

type ThinkingChildContext = {
	run: AssistantContentRun;
	hidden: boolean;
	live: boolean;
	label: string | null;
};

function isCollapsedTailEnabled(context: ThinkingChildContext): context is ThinkingChildContext & { label: string } {
	return context.hidden && context.label !== null && loadConfig().collapsedThinking === "tail";
}

/** Visible thinking text is a dim italic aside; plain-text it so Pi's per-theme colors don't leak in. */
function styleThinkingLine(text: string): string {
	const plain = stripAnsi(text);
	return plain.trim().length === 0 ? plain : `\x1b[3m${geekFg("dim", plain)}\x1b[23m`;
}

function makeThinkingChildPlain(child: any, context: ThinkingChildContext): void {
	if (!child || typeof child.render !== "function" || child.__plainThinkingPatched) return;
	child.__plainThinkingPatched = true;

	const baseRender = child.render.bind(child);
	child.render = (width: number): string[] => {
		const collapsedRow = isCollapsedTailEnabled(context)
			? buildCollapsedThinkingRow(context.run, context.label, context.live, width)
			: null;
		return collapsedRow !== null ? [collapsedRow] : baseRender(width).map(styleThinkingLine);
	};
}

/** True when a text, thinking or tool-call block sits after the run's last block, which settles it. */
function hasBlockAfter(content: any[], endBlockIndex: number): boolean {
	for (let i = endBlockIndex + 1; i < content.length; i++) {
		const type = content[i]?.type;
		if (type === "text" || type === "thinking" || type === "toolCall") return true;
	}
	return false;
}

function patchThinkingChildren(component: any, runs: AssistantContentRun[], message: any, liveStream: boolean): void {
	let thinkingOrdinal = 0;
	const content = Array.isArray(message?.content) ? message.content : [];
	const label = typeof component?.hiddenThinkingLabel === "string" ? trimLabelProgressDots(component.hiddenThinkingLabel) : null;
	const visibilityOverrides = component.thinkingVisibilityOverrides as Map<number, boolean>;

	for (const run of runs) {
		if (run.kind !== "thinking") continue;
		// Same rule as Pi's own AssistantMessageComponent: a per-run toggle wins over the global setting.
		const hidden = visibilityOverrides.get(thinkingOrdinal) ?? Boolean(component.hideThinkingBlock);
		const live = liveStream && !hasBlockAfter(content, run.endBlockIndex);
		makeThinkingChildPlain(component?.contentContainer?.children?.[run.childIndex], { run, hidden, live, label });
		thinkingOrdinal++;
	}
}

export function installAssistantMessagePrefix(_theme?: unknown, componentClass: any = AssistantMessageComponent): void {
	const proto = componentClass?.prototype as any;
	if (!proto) return;
	if (proto[PATCHED] || proto.render?.name === "patchedAssistantMessageRender") {
		proto[PATCHED] = true;
		return;
	}
	proto[PATCHED] = true;
	markRailed(componentClass);

	const baseUpdateContent = proto.updateContent;
	if (typeof baseUpdateContent === "function") {
		proto.updateContent = function patchedAssistantUpdateContent(message: any): void {
			// Tag before the base delegate so this wrapper's message is the identity the tag is built from.
			const liveStream = attachComponentToStream(this, message);
			claimTurnHead(this);
			baseUpdateContent.call(this, message);

			if (!message || !Array.isArray(message.content)) return;
			patchThinkingChildren(this, getAssistantContentRuns(message), message, liveStream);
		};
	}

	const baseRender = proto.render;

	proto.render = function patchedAssistantMessageRender(width: number): string[] {
		if (width <= 0) return baseRender.call(this, width);
		const raw: string[] = baseRender.call(this, getAssistantBodyWidth(width));
		const body = revealBody(this, trimBlankEdges(raw));
		const rows = assistantHeadRows(this, width);
		if (body.length > 0) {
			for (const line of body) rows.push(geekRow("line", dropLeadingColumns(line, 1), width));
			rows.push(geekRow("line", "", width));
		}
		return keepPromptZone(raw, rows);
	};
}

/** Head row(s) for the component that opens its turn (tool groups call this for the assistant messages they fold). */
export function assistantHeadRows(component: any, width: number): string[] {
	return turnHeadRows(component, width);
}
