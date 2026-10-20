import { sliceByColumn, stripTerminalSequences } from "@earendil-works/pi-tui";
import { GEEK_PREFIX_WIDTH } from "./presentation/geek-rows.js";
import { getOriginalTuiMethod, rememberTuiMethodWrapper } from "./performance/tui-proxy-original.js";
import { tuiMarginLeft } from "./tui-padding.js";

/**
 * Fullscreen text selection skips the transcript rail (` ┊ `, ` • `, ` ┃ `), so a drag over several messages
 * highlights and copies only the message text. Pi derives both the highlight and the copied text from
 * `getSelectionColumns`. A drag that starts inside the transcript passes transcript rows (rail at `minColumn`); one
 * that starts in the left margin passes whole screen rows (rail right after the margin).
 */

const PATCHED = Symbol.for("pi-geek-tui.selection-rail.patched");
const RAIL_PREFIX = /^ [•┊┃ ] $/;

type SelectionPoint = { scrollView?: unknown };
type GetSelectionColumns = (line: string, row: number, selection: { start: SelectionPoint }, minColumn?: number, maxColumn?: number) => unknown;

function hasRailAt(line: string, column: number): boolean {
	return RAIL_PREFIX.test(stripTerminalSequences(sliceByColumn(line, column, GEEK_PREFIX_WIDTH, true)));
}

export function installSelectionSkipsRail(tui: unknown): void {
	const state = tui as Record<PropertyKey, unknown> | undefined;
	if (!state || state[PATCHED] || typeof state.getSelectionColumns !== "function") return;
	state[PATCHED] = true;
	const base = getOriginalTuiMethod(tui, "getSelectionColumns") as unknown as GetSelectionColumns;
	const skipRail: GetSelectionColumns = function (this: unknown, line, row, selection, minColumn = 0, maxColumn) {
		const railColumn = selection?.start?.scrollView ? minColumn : Math.max(minColumn, tuiMarginLeft());
		const start = hasRailAt(line, railColumn) ? railColumn + GEEK_PREFIX_WIDTH : minColumn;
		return base.call(this, line, row, selection, start, maxColumn);
	};
	state.getSelectionColumns = skipRail;
	rememberTuiMethodWrapper(tui, "getSelectionColumns", skipRail);
}
