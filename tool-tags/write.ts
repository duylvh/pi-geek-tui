import { getLanguageFromPath } from "@earendil-works/pi-coding-agent";

import { loadConfig } from "../config.js";
import { buildAddedRows } from "../split-diff.js";
import { stripAnsi } from "../theme/ansi.js";
import { geekFg } from "../theme/geek-palette.js";
import { getTextOutput, isExpanded, resolveRelativePath } from "./common.js";
import { paramText, soloLine } from "./tool-call-line.js";
import { diffSectionsBody, publishFailedMeta } from "./edit.js";
import { markToolCallExecutionStarted, resolveToolCallElapsedMs } from "./elapsed.js";
import { EMPTY_BODY, metaText, renderCallRow, renderOutputBody, setRowMeta } from "./tool-row.js";
import { secondsText } from "./tool-summary.js";

export function renderWriteCall(args: any, _theme: any, context: any) {
	markToolCallExecutionStarted(context);
	const rawPath = String(args?.path ?? args?.file_path ?? "");
	const cwd = typeof context?.cwd === "string" ? context.cwd : process.cwd();
	return renderCallRow(soloLine("write", paramText((rawPath ? resolveRelativePath(rawPath, cwd) : "")), Boolean(context?.isError)), context);
}

/** Meta `+N · 0.1s` (lines written); Ctrl+O shows the file as added rows, capped at maxExpandedLines. */
export function renderWriteResult(result: any, options: any, _theme: any, context: any) {
	if (options?.isPartial) return EMPTY_BODY;
	if (result.isError) {
		publishFailedMeta(context, result);
		return renderOutputBody(result, { expanded: true });
	}

	const content = String(context?.args?.content ?? "");
	const rows = content ? buildAddedRows(content) : [];
	const elapsed = resolveToolCallElapsedMs(context, result);
	setRowMeta(context?.state, metaText([geekFg("mono", `+${rows.length}`), ...(elapsed !== undefined ? [secondsText(elapsed)] : [])]));
	if (rows.length === 0) {
		const output = stripAnsi(getTextOutput(result)).trim();
		return output ? renderOutputBody({ content: [{ type: "text", text: output }] }, { expanded: true }) : EMPTY_BODY;
	}
	if (!isExpanded(options)) return EMPTY_BODY;
	const path = String(context?.args?.path ?? context?.args?.file_path ?? "");
	const cap = loadConfig().maxExpandedLines;
	return diffSectionsBody([{ rows, language: path ? getLanguageFromPath(path) : undefined }], cap > 0 ? cap : rows.length);
}
