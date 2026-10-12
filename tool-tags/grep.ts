import { markToolCallExecutionStarted } from "./elapsed.js";
import { callParams, soloLine } from "./tool-call-line.js";
import { renderCallRow, renderOutputBody } from "./tool-row.js";

export function renderGrepCall(args: any, _theme: any, context: any) {
	markToolCallExecutionStarted(context);
	return renderCallRow(soloLine("grep", callParams("grep", args), Boolean(context?.isError)), context);
}

/** Expanded body: the listing, capped at maxExpandedLines. */
export function renderGrepResult(result: any, options: any, _theme: any, _context: any) {
	return renderOutputBody(result, options);
}
