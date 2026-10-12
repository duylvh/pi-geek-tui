import { markToolCallExecutionStarted } from "./elapsed.js";
import { callParams, soloLine } from "./tool-call-line.js";
import { renderCallRow, renderOutputBody } from "./tool-row.js";

export function renderFindCall(args: any, _theme: any, context: any) {
	markToolCallExecutionStarted(context);
	return renderCallRow(soloLine("find", callParams("find", args), Boolean(context?.isError)), context);
}

/** Expanded body: the listing, capped at maxExpandedLines. */
export function renderFindResult(result: any, options: any, _theme: any, _context: any) {
	return renderOutputBody(result, options);
}
