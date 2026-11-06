import { sliceByColumn, stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { GEEK_PREFIX_WIDTH, GEEK_PROMPT } from "./presentation/geek-rows.js";
import { getOriginalTuiMethod, rememberTuiMethodWrapper } from "./performance/tui-proxy-original.js";
import { tuiMarginLeft } from "./tui-padding.js";

/**
 * Fullscreen text selection skips the transcript rail (` ┊ `, ` • `, ` ┃ `), so a drag over several messages
 * highlights and copies only the message text. Pi derives both the highlight and the copied text from
 * `getSelectionColumns`. A drag that starts inside the transcript passes transcript rows (rail at `minColumn`); one
 * that starts in the left margin passes whole screen rows (rail right after the margin).
 * Prompt rows (`› text`, the input editor and user messages) also skip the prompt and end at the text, so the
 * editor's cursor block is never inverted; rule rows (`────`) select nothing.
 */

const PATCHED = Symbol.for("pi-geek-tui.selection-rail.patched");
const RAIL_PREFIX = /^ [•┊┃ ] $/;
const RULE_ROW = /^\s*─+\s*$/;

type SelectionPoint = { scrollView?: unknown };
type SelectionColumns = { start: number; end: number };
type GetSelectionColumns = (line: string, row: number, selection: { start: SelectionPoint }, minColumn?: number, maxColumn?: number) => SelectionColumns;

function plainSlice(line: string, column: number, width: number): string {
	return stripTerminalSequences(sliceByColumn(line, column, width, true));
}

export function installSelectionSkipsRail(tui: unknown): void {
	const state = tui as Record<PropertyKey, unknown> | undefined;
	if (!state || state[PATCHED] || typeof state.getSelectionColumns !== "function") return;
	state[PATCHED] = true;
	const base = getOriginalTuiMethod(tui, "getSelectionColumns") as unknown as GetSelectionColumns;
	const skipRail: GetSelectionColumns = function (this: unknown, line, row, selection, minColumn = 0, maxColumn) {
		const plain = stripTerminalSequences(line);
		if (RULE_ROW.test(plain)) return { start: minColumn, end: minColumn };
		const railColumn = selection?.start?.scrollView ? minColumn : Math.max(minColumn, tuiMarginLeft());
		if (!RAIL_PREFIX.test(plainSlice(line, railColumn, GEEK_PREFIX_WIDTH))) return base.call(this, line, row, selection, minColumn, maxColumn);
		const bodyColumn = railColumn + GEEK_PREFIX_WIDTH;
		if (plainSlice(line, bodyColumn, GEEK_PROMPT.length) !== GEEK_PROMPT) return base.call(this, line, row, selection, bodyColumn, maxColumn);
		const textEnd = visibleWidth(plain.trimEnd());
		const columns = base.call(this, line, row, selection, bodyColumn + GEEK_PROMPT.length, maxColumn);
		return { start: columns.start, end: Math.min(columns.end, textEnd) };
	};
	state.getSelectionColumns = skipRail;
	rememberTuiMethodWrapper(tui, "getSelectionColumns", skipRail);
}
