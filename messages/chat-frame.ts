// Seam for the rail-grammar invariant: EVERY chat row is gutter(5) + rail(3) + body. Our own components
// (user/assistant/core messages, tool rows) already emit grammar rows and are marked; anything else Pi
// puts in the chat container (showStatus/showWarning/showError/notify Text, Markdown, borders, bash
// output, announcements…) renders at body width here and gets the prefix.
//
// Children themselves are never wrapped or replaced, so Pi's identity checks keep working
// (showStatus updates `lastStatusText` in place when statuses arrive back-to-back).
import { dropLeadingColumns, stripAnsi } from "../theme/ansi.js";
import { GEEK_PREFIX_WIDTH, geekRow } from "../presentation/geek-rows.js";
import { hasTurnStarted } from "./message-meta.js";

const RAILED = Symbol.for("pi-geek-tui.chat-frame.railed");
const TURN_START = Symbol.for("pi-geek-tui.chat-frame.turn-start");

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
 * Rows for one chat child. `next` is the following sibling: a Spacer right before a user message separates
 * turns and stays un-railed; every other spacer inside a turn keeps the rail continuous.
 */
export function frameChatChild(child: any, width: number, next?: any): string[] {
	if (width <= 0 || isRailed(child)) return child.render(width);
	const rail = hasTurnStarted() && !(isSpacer(child) && isTurnStart(next)) ? "line" : "blank";
	if (isSpacer(child)) return child.render(width).map(() => geekRow(rail, "", width));
	const bodyWidth = Math.max(1, width - GEEK_PREFIX_WIDTH - 1);
	return child.render(bodyWidth).map((row: string) => geekRow(rail, stripAnsi(row).startsWith(" ") ? dropLeadingColumns(row, 1) : row, width));
}
