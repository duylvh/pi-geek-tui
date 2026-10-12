import { stripAnsi } from "../theme/ansi.js";
import { markToolCallExecutionStarted } from "./elapsed.js";
import { describeCall } from "./tool-summary.js";
import { renderCallRow, renderOutputBody } from "./tool-row.js";

const BASH_TOOL_NOTICE_PATTERN = /^\[Showing (?:last|lines)\b.*\. Full output: .+\]$/;

function stripBashToolNoticeLines(text: string): string {
	const filteredLines = text
		.replace(/\r/g, "")
		.split("\n")
		.filter((line) => !BASH_TOOL_NOTICE_PATTERN.test(line.trim()));
	return filteredLines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd();
}

export function renderBashCall(args: any, _theme: any, context: any) {
	markToolCallExecutionStarted(context);
	return renderCallRow(describeCall("bash", args).text || "...", context);
}

/** Expanded body: tail of the output (the end is what a command reports), notices stripped. */
export function renderBashResult(result: any, options: any, _theme: any, _context: any) {
	return renderOutputBody(result, options, { tail: true, transform: stripBashToolNoticeLines });
}
