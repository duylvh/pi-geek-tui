// Chat-level bookkeeping Pi's components don't keep: the message timestamp (head row time), which
// assistant component opens a turn (only that one prints the `pi@agent` head row), and the railed
// spacer between chat and input zone.
//
// Chat order == construction order for both live streaming and session resume, and every user
// message passes through InteractiveMode.addMessageToChat, so a counter bumped there delimits turns.
// Counter lives on globalThis and answers are stamped on the components, so an extension reload
// (fresh module instance) keeps existing components consistent.

import { geekHeadRow } from "../presentation/geek-head.js";
import { geekRow } from "../presentation/geek-rows.js";

const PATCHED = Symbol.for("pi-geek-tui.message-meta.patched");
const STATE = Symbol.for("pi-geek-tui.message-meta.state");
const TIMESTAMP = Symbol.for("pi-geek-tui.message-meta.timestamp");
const TURN_HEAD = Symbol.for("pi-geek-tui.message-meta.turn-head");

type Timestamp = number | string | undefined;
type Stamped = { [TIMESTAMP]?: Timestamp; [TURN_HEAD]?: boolean };
type TurnState = { turn: number; headedTurn: number };

function state(): TurnState {
	const shared = globalThis as unknown as Record<symbol, TurnState>;
	return (shared[STATE] ??= { turn: 0, headedTurn: -1 });
}

export function getMessageTimestamp(component: object): Timestamp {
	return (component as Stamped)[TIMESTAMP];
}

/** The first assistant component of a turn owns the head row; decided once, at its first update. */
export function claimTurnHead(component: object): boolean {
	const stamped = component as Stamped;
	if (stamped[TURN_HEAD] === undefined) {
		const turns = state();
		stamped[TURN_HEAD] = turns.turn !== turns.headedTurn;
		turns.headedTurn = turns.turn;
	}
	return stamped[TURN_HEAD];
}

const FIRST_SEEN = Symbol.for("pi-geek-tui.message-meta.first-seen");

/**
 * `HH:MM • pi@agent …` row for an assistant component that opens its turn, else []. Read-only: safe to
 * call from anything that renders on the component's behalf (tool groups fold tool-only assistant
 * messages and never render them).
 */
export function turnHeadRows(component: any, width: number): string[] {
	if (width <= 0 || !(component as Stamped)[TURN_HEAD]) return [];
	const stamp = component.lastMessage?.timestamp ?? getMessageTimestamp(component) ?? (component[FIRST_SEEN] ??= Date.now());
	return [geekHeadRow("agent", width, stamp)];
}

// Pi always keeps a Spacer(1) in widgetContainerAbove (between the chat and the input zone). Left alone it
// is the one un-railed blank inside the rail column, so it is swapped for a railed blank row.
const RAIL_SPACER = { invalidate() {}, render: (width: number): string[] => [geekRow("line", "", width)] };
const RAILED = Symbol.for("pi-geek-tui.message-meta.railed-widgets");

function railWidgetSpacers(mode: any): void {
	const children: any[] | undefined = mode.widgetContainerAbove?.children;
	if (children) mode.widgetContainerAbove.children = children.map((child) => (child?.constructor?.name === "Spacer" ? RAIL_SPACER : child));
}

export function installMessageMeta(InteractiveModeClass: any): void {
	const proto = InteractiveModeClass?.prototype;
	if (!proto || proto[PATCHED] || typeof proto.addMessageToChat !== "function") return;
	proto[PATCHED] = true;

	const baseRenderWidgetContainer = proto.renderWidgetContainer;
	if (typeof baseRenderWidgetContainer === "function") {
		proto.renderWidgetContainer = function patchedRenderWidgetContainer(this: any, container: any, ...rest: any[]): unknown {
			const result = baseRenderWidgetContainer.call(this, container, ...rest);
			if (container === this.widgetContainerAbove) railWidgetSpacers(this);
			return result;
		};
	}

	const base = proto.addMessageToChat;
	proto.addMessageToChat = function patchedAddMessageToChat(this: any, message: any, ...rest: any[]): unknown {
		if (!this[RAILED] && typeof this.renderWidgets === "function") {
			// The spacer built before this patch existed is still in place; rebuild the container once.
			this[RAILED] = true;
			this.renderWidgets();
		}
		const children: any[] | undefined = this.chatContainer?.children;
		const before = children?.length ?? 0;
		if (message?.role === "user") state().turn++;
		const result = base.call(this, message, ...rest);
		if (children && message?.timestamp !== undefined) {
			for (let i = before; i < children.length; i++) (children[i] as Stamped)[TIMESTAMP] = message.timestamp;
		}
		return result;
	};
}

const ZONE_START = "\x1b]133;A\x07";
const ZONE_END = "\x1b]133;B\x07\x1b]133;C\x07";

/** Pi tags a message's first/last row with OSC 133 prompt-zone marks; re-attach them to the restyled rows. */
export function keepPromptZone(rawLines: string[], rows: string[]): string[] {
	if (rows.length === 0) return rows;
	const out = rows.map((row) => row.replaceAll(ZONE_START, "").replaceAll(ZONE_END, ""));
	if (rawLines[0]?.startsWith(ZONE_START)) out[0] = ZONE_START + out[0];
	if (rawLines[rawLines.length - 1]?.includes(ZONE_END)) out[out.length - 1] += ZONE_END;
	return out;
}
