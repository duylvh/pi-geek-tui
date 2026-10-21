// Seam for the rail-grammar invariant: EVERY chat row is rail(3) + body. Our own components
// (user/assistant/core messages, tool rows) already emit grammar rows and are marked; anything else Pi
// puts in the chat container (showStatus/showWarning/showError/notify Text, Markdown, borders, bash
// output, announcements…) renders at body width here and gets the prefix.
//
// Children themselves are never wrapped or replaced, so Pi's identity checks keep working
// (showStatus updates `lastStatusText` in place when statuses arrive back-to-back).
import { dropLeadingColumns, stripAnsi } from "../theme/ansi.js";
import { GEEK_PREFIX_WIDTH, geekRow } from "../presentation/geek-rows.js";
import { geekFg } from "../theme/geek-palette.js";
import { hasTurnStarted } from "./message-meta.js";

const RAILED = Symbol.for("pi-geek-tui.chat-frame.railed");
const TURN_START = Symbol.for("pi-geek-tui.chat-frame.turn-start");
const IN_TURN = Symbol.for("pi-geek-tui.chat-frame.in-turn");

/** Mark a component class as already rendering grammar rows; `turnStart` for ones that open a turn (user messages). */
export function markRailed(componentClass: any, turnStart = false): void {
	const proto = componentClass?.prototype;
	if (!proto) return;
	proto[RAILED] = true;
	if (turnStart) proto[TURN_START] = true;
}

const isRailed = (child: any): boolean => Boolean(child?.[RAILED]) || typeof child?.toolCallId === "string";
const isTurnStart = (child: any): boolean => Boolean(child?.[TURN_START]);
const isSpacer = (child: any): boolean => child?.constructor?.name === "Spacer";

/**
 * Rows for one chat child. `next`/`prev` are its siblings. A Spacer right before a user message separates
 * turns and stays un-railed; every other spacer inside a turn keeps the rail continuous, but adds nothing
 * after a grammar block (which already ends in a railed blank row) or another spacer: exactly one `┊`
 * separator between blocks.
 */
export function frameChatChild(child: any, width: number, next?: any, prev?: any): string[] {
	if (width <= 0 || isRailed(child)) return child.render(width);
	// Decided at the child's first render (right after Pi adds it), so a startup notice stays outside the
	// rail when a turn begins later.
	child[IN_TURN] ??= hasTurnStarted();
	const rail = child[IN_TURN] && !(isSpacer(child) && isTurnStart(next)) ? "line" : "blank";
	if (isSpacer(child)) {
		if (rail === "line" && (isRailed(prev) || isSpacer(prev))) return [];
		return child.render(width).map(() => geekRow(rail, "", width));
	}
	return child.render(framedChildWidth(child, width)).map((row: string) => geekRow(rail, stripAnsi(row).startsWith(" ") ? dropLeadingColumns(row, 1) : row, width));
}

/** Width `frameChatChild` renders `child` at: grammar components get the full row, the rest the body column. */
export function framedChildWidth(child: any, width: number): number {
	return width <= 0 || isRailed(child) ? width : Math.max(1, width - GEEK_PREFIX_WIDTH - 1);
}

/** A dim one-line notice on a blank rail (body at col 3), for rows the extension itself injects between chat children. */
export function frameNoticeRow(text: string, width: number): string {
	return geekRow("blank", geekFg("dim", text), width);
}
