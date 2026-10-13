import type { GeekRail } from "../presentation/geek-rows.js";
import { geekFg } from "../theme/geek-palette.js";
import { resolveToolCallElapsedMs, runningElapsedMs } from "./elapsed.js";

/** Calls that show their own diff/preview rows; they never fold into a summary group. */
const EDIT_CLASS_TOOLS = new Set(["edit", "write", "quick_edit", "substitute_edit", "target_edit"]);

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
function formatSeconds(ms: number): string {
	return (Math.max(0, ms) / 1000).toFixed(1);
}

/** `1.9s` with num value + dim unit. */
export function secondsText(ms: number): string {
	return `${geekFg("num", formatSeconds(ms))}${geekFg("dim", "s")}`;
}
