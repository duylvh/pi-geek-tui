import { markToolCallExecutionStarted } from "./elapsed.js";
import { describeCall } from "./tool-summary.js";
import { renderCallRow, renderOutputBody } from "./tool-row.js";

export function renderLsCall(args: any, _theme: any, context: any) {
	markToolCallExecutionStarted(context);
	const { verb, text } = describeCall("ls", args);
	return renderCallRow(`${verb} ${text}`, context);
}

/** Expanded body: the listing, capped at maxExpandedLines. */
export function renderLsResult(result: any, options: any, _theme: any, _context: any) {
	return renderOutputBody(result, options);
}
