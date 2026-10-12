import { basename } from "node:path";

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
			return { verb: "", text: clip(String(args?.command ?? "").split("\n")[0] ?? "") };
		default:
			return { verb: toolName, text: firstStringArg(args) };
	}
}

/** `read a b · grep X · pnpm test`: same-verb neighbours merge, the rest are joined by a faint dot. */
export function summarizeCalls(calls: CallSummary[]): string {
	const parts: string[] = [];
	let last: { verb: string; texts: string[] } | undefined;
	const flush = () => {
		if (!last) return;
		parts.push(last.verb ? [last.verb, ...last.texts].filter(Boolean).join(" ") : last.texts.join(" "));
		last = undefined;
	};
	for (const call of calls) {
		if (last && call.verb && last.verb === call.verb) {
			if (call.text) last.texts.push(call.text);
			continue;
		}
		flush();
		last = { verb: call.verb, texts: call.text ? [call.text] : [] };
	}
	flush();
	return parts.filter(Boolean).join(geekFg("faint", " · "));
}
