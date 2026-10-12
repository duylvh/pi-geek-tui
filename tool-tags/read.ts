import { getLanguageFromPath, highlightCode } from "@earendil-works/pi-coding-agent";

import { safeTruncateToWidth } from "../render-budget.js";
import { stripAnsi } from "../theme/ansi.js";
import { geekFg } from "../theme/geek-palette.js";
import { extractTrailingNotice, getTextOutput, stripTrailingNotice } from "./common.js";
import { markToolCallExecutionStarted } from "./elapsed.js";
import { describeCall } from "./tool-summary.js";
import { EMPTY_BODY, renderBody, renderCallRow, renderOutputBody } from "./tool-row.js";

const MAX_HIGHLIGHT_OUTPUT_CHARS = 12000;
const MAX_HIGHLIGHT_OUTPUT_LINES = 300;

type NumberedReadLine = {
	lineNumber: string;
	content: string;
};

type ParsedReadOutput = {
	fileHash?: string;
	numberedLines?: NumberedReadLine[];
	body: string;
};

function parseReadOutput(text: string): ParsedReadOutput {
	const fileHashMatch = text.match(/^fileHash: ([^\n]+)\n\n/);
	const body = fileHashMatch ? text.slice(fileHashMatch[0].length) : text;
	const rawLines = body ? body.split("\n") : [];
	const numberedLines = rawLines.map((line) => line.match(/^\s*(\d+)\| ?(.*)$/));

	if (numberedLines.length > 0 && numberedLines.every(Boolean)) {
		return {
			fileHash: fileHashMatch?.[1],
			body: numberedLines.map((match) => match?.[2] ?? "").join("\n"),
			numberedLines: numberedLines.map((match) => ({
				lineNumber: match?.[1] ?? "",
				content: match?.[2] ?? "",
			})),
		};
	}

	return { fileHash: fileHashMatch?.[1], body };
}

export function renderReadCall(args: any, _theme: any, context: any) {
	markToolCallExecutionStarted(context);
	const { verb, text } = describeCall("read", args);
	return renderCallRow(`${verb} ${text || "(unknown)"}`, context);
}

/** Expanded body: numbered, syntax-highlighted file content capped at maxExpandedLines. */
export function renderReadResult(result: any, options: any, _theme: any, context: any) {
	if (!options?.expanded) return EMPTY_BODY;
	if (result.isError) return renderOutputBody(result, options);
	const output = stripAnsi(getTextOutput(result)).trimEnd();
	if (Array.isArray(result.content) && result.content.some((block: any) => block?.type === "image")) return EMPTY_BODY;

	const parsed = parseReadOutput(stripTrailingNotice(output));
	const truncationNotice = extractTrailingNotice(output);
	const lang = getLanguageFromPath(String(context?.args?.path ?? context?.args?.file_path ?? ""));
	const lineCount = parsed.numberedLines?.length ?? parsed.body.split("\n").length;
	const shouldHighlight = Boolean(lang) && parsed.body.length <= MAX_HIGHLIGHT_OUTPUT_CHARS && lineCount <= MAX_HIGHLIGHT_OUTPUT_LINES;

	return renderBody(true, (width, maxLines) => {
		const sourceLines = parsed.body.split("\n");
		const shown = maxLines > 0 ? sourceLines.slice(0, maxLines) : sourceLines;
		let colored = shown.map((line) => geekFg("ink", line));
		if (shouldHighlight && lang) {
			try {
				colored = highlightCode(shown.join("\n"), lang);
			} catch {
				// keep plain ink
			}
		}
		const numbers = parsed.numberedLines;
		const numberWidth = numbers ? Math.max(...numbers.slice(0, shown.length).map((line) => line.lineNumber.length)) : 0;
		const gutter = numbers ? numberWidth + 3 : 0;
		const rows = shown.map((_, i) => {
			const code = safeTruncateToWidth(colored[i] ?? "", Math.max(1, width - gutter), "…");
			return numbers ? `${geekFg("faint", `${(numbers[i]?.lineNumber ?? "").padStart(numberWidth)} │ `)}${code}` : code;
		});
		if (shown.length < sourceLines.length) rows.push(geekFg("faint", `… ${sourceLines.length - shown.length} more lines`));
		if (truncationNotice) rows.push(geekFg("dim", safeTruncateToWidth(truncationNotice, width, "…")));
		return rows;
	});
}
