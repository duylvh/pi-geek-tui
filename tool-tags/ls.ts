import { markToolCallExecutionStarted } from "./elapsed.js";
import { callParams, soloLine } from "./tool-call-line.js";
import { renderCallRow, renderOutputBody } from "./tool-row.js";

export function renderLsCall(args: any, _theme: any, context: any) {
	markToolCallExecutionStarted(context);
	return renderCallRow(soloLine("ls", callParams("ls", args), Boolean(context?.isError)), context);
}

/** Expanded body: the listing, capped at maxExpandedLines. */
export function renderLsResult(result: any, options: any, _theme: any, _context: any) {
	return renderOutputBody(result, options);
}
