import { basename } from "node:path";

import { safeTruncateToWidth, safeVisibleWidth } from "../render-budget.js";
import type { GeekRail } from "../presentation/geek-rows.js";
import { geekFg } from "../theme/geek-palette.js";
import { resolveToolCallElapsedMs, runningElapsedMs } from "./elapsed.js";

/** Calls that show their own diff/preview rows; they never fold into a summary group. */
const EDIT_CLASS_TOOLS = new Set(["edit", "write", "quick_edit", "substitute_edit", "target_edit"]);
const MAX_CALL_TEXT = 48;

export function isEditClassTool(toolName: unknown): boolean {
	return typeof toolName === "string" && EDIT_CLASS_TOOLS.has(toolName);
}

/** Pi's ToolExecutionComponent, recognised by shape so grouping never imports the host class. */
export function isToolComponent(component: any): boolean {
	return typeof component?.toolCallId === "string" && typeof component?.toolName === "string";
}

/** Cheap "still executing" test, also the signal the conversation rail reads for the active `┃`. */
export function isToolRunning(tool: any): boolean {
	return !tool?.result || Boolean(tool.isPartial);
}

/** Rail for a tool block's rows: accent while any call runs, del marker if one failed, else kw. */
export function toolRail(tools: any[]): GeekRail {
	if (tools.some(isToolRunning)) return "active";
	return tools.some((tool) => Boolean(tool.result?.isError)) ? "tool-error" : "tool-ok";
}

export function toolElapsedMs(tool: any, now = performance.now()): number | undefined {
	const state = tool?.rendererState;
	if (isToolRunning(tool)) return runningElapsedMs(state, now);
	return resolveToolCallElapsedMs({ state, toolCallId: tool.toolCallId }, tool.result);
}

/** `1.9` for the num-colored seconds; the unit is styled separately. */
export function formatSeconds(ms: number): string {
	return (Math.max(0, ms) / 1000).toFixed(1);
}

/** `1.9s` with num value + dim unit. */
export function secondsText(ms: number): string {
	return `${geekFg("num", formatSeconds(ms))}${geekFg("dim", "s")}`;
}

function clip(text: string, max = MAX_CALL_TEXT): string {
	const flat = text.replace(/\s+/g, " ").trim();
	return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function fileLabel(path: unknown): string {
	const raw = typeof path === "string" ? path.trim() : "";
	return raw ? basename(raw) || raw : "";
}

/** First short string argument, for tools we know nothing about. */
function firstStringArg(args: any): string {
	if (!args || typeof args !== "object") return "";
	for (const value of Object.values(args)) {
		if (typeof value === "string" && value.trim()) return clip(value);
	}
	return "";
}

export type CallSummary = {
	/** Group merges consecutive calls with the same non-empty verb: `read a b`. Bash has no verb. */
	verb: string;
	text: string;
};

const LEADING_CD = /^\s*cd\s+(?:"[^"]*"|'[^']*'|\S+)\s*(?:&&|;)\s*/;

/** `cd /long/project/path && git log` names the command, not the directory every call shares. */
function stripLeadingCd(command: string): string {
	let rest = command;
	while (LEADING_CD.test(rest)) rest = rest.replace(LEADING_CD, "");
	return rest.trim() ? rest : command;
}

export function describeCall(toolName: string, args: any): CallSummary {
	switch (toolName) {
		case "read":
			return { verb: "read", text: fileLabel(args?.path ?? args?.file_path) };
		case "ls":
			return { verb: "ls", text: fileLabel(args?.path) || "." };
		case "find":
			return { verb: "find", text: clip(String(args?.pattern ?? "")) };
		case "grep":
			return { verb: "grep", text: clip(String(args?.pattern ?? "")) };
		case "bash":
			return { verb: "", text: clip(stripLeadingCd(String(args?.command ?? "").split("\n")[0] ?? "")) };
		default:
			return { verb: toolName, text: firstStringArg(args) };
	}
}

type SummaryPart = { text: string; calls: number };

/** Same-verb neighbours merge (`read a b`); verb-less calls (bash) stay separate. */
function mergeCalls(calls: CallSummary[]): SummaryPart[] {
	const parts: Array<{ verb: string; texts: string[]; calls: number }> = [];
	for (const call of calls) {
		const last = parts[parts.length - 1];
		if (last && call.verb && last.verb === call.verb) {
			if (call.text) last.texts.push(call.text);
			last.calls++;
		} else {
			parts.push({ verb: call.verb, texts: call.text ? [call.text] : [], calls: 1 });
		}
	}
	return parts
		.map((part) => ({ text: (part.verb ? [part.verb, ...part.texts] : part.texts).filter(Boolean).join(" "), calls: part.calls }))
		.filter((part) => part.text);
}

const MIN_PART_CELLS = 10;
const SEPARATOR = " · ";

/**
 * `read a b · grep X · pnpm test` fitted into `room` cells. A call is never dropped silently:
 * long parts shrink evenly first; if they still cannot fit, trailing parts collapse into `· +N`.
 */
export function summarizeCalls(calls: CallSummary[], room = Number.POSITIVE_INFINITY): string {
	const parts = mergeCalls(calls);
	const widths = parts.map((part) => safeVisibleWidth(part.text));
	for (let shown = parts.length; shown >= 1; shown--) {
		const hidden = parts.slice(shown).reduce((sum, part) => sum + part.calls, 0);
		const suffix = hidden > 0 ? `${SEPARATOR}+${hidden}` : "";
		const avail = room - SEPARATOR.length * (shown - 1) - suffix.length;
		const natural = widths.slice(0, shown).reduce((sum, width) => sum + width, 0);
		let cap = Number.POSITIVE_INFINITY;
		if (natural > avail) {
			cap = Math.max(...widths.slice(0, shown));
			while (cap > MIN_PART_CELLS && widths.slice(0, shown).reduce((sum, width) => sum + Math.min(width, cap), 0) > avail) cap--;
			const fits = widths.slice(0, shown).reduce((sum, width) => sum + Math.min(width, cap), 0) <= avail;
			if (!fits && shown > 1) continue;
		}
		const faint = (text: string) => geekFg("faint", text);
		const body = parts
			.slice(0, shown)
			.map((part, index) => geekFg("ink", widths[index]! > cap ? safeTruncateToWidth(part.text, cap, "…") : part.text))
			.join(faint(SEPARATOR));
		return hidden > 0 ? `${body}${faint(SEPARATOR)}${geekFg("dim", `+${hidden}`)}` : body;
	}
	return "";
}
