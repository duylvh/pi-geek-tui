// User prompt rows (spec §2/§3): head row `HH:MM • bean@proj ~/path (branch)` then `│ › text`.
import { UserMessageComponent } from "@earendil-works/pi-coding-agent";

import { geekHeadRow } from "../presentation/geek-head.js";
import { GEEK_PREFIX_WIDTH, geekRow } from "../presentation/geek-rows.js";
import { safeVisibleWidth } from "../render-budget.js";
import { dropLeadingColumns, stripAnsi } from "../theme/ansi.js";
import { geekFg } from "../theme/geek-palette.js";
import { markRailed } from "./chat-frame.js";
import { getMessageTimestamp, keepPromptZone } from "./message-meta.js";

const PATCHED = Symbol.for("pi-geek-tui.user-prefix.patched");
const FIRST_SEEN = Symbol.for("pi-geek-tui.user-prefix.first-seen");
const PROMPT = "› ";

/** Pi's user box is padded 1 column on each side; its background/emphasis give way to plain ink. */
function plainBodyLines(lines: string[]): string[] {
	let first = 0;
	while (first < lines.length && stripAnsi(lines[first] ?? "").trim() === "") first++;
	let last = lines.length - 1;
	while (last > first && stripAnsi(lines[last] ?? "").trim() === "") last--;
	return lines.slice(first, last + 1).map((line) => stripAnsi(dropLeadingColumns(line, 1)).trimEnd());
}

export function installUserMessagePrefix(_theme?: unknown): void {
	const proto = UserMessageComponent.prototype as any;
	if (proto[PATCHED] || proto.render?.name === "patchedUserMessageRender") {
		proto[PATCHED] = true;
		return;
	}
	proto[PATCHED] = true;
	markRailed(UserMessageComponent, true);

	const baseRender = proto.render;

	proto.render = function patchedUserMessageRender(width: number): string[] {
		if (width <= 0) return baseRender.call(this, width);
		const bodyWidth = Math.max(1, width - GEEK_PREFIX_WIDTH - PROMPT.length);
		const raw: string[] = baseRender.call(this, bodyWidth + 2);
		const body = plainBodyLines(raw);
		if (body.length === 0) return [];

		// Live messages are rendered right after creation, so first-render time is the send time when
		// Pi's addMessageToChat stamp (message-meta) is missing.
		const stamp = getMessageTimestamp(this) ?? (this[FIRST_SEEN] ??= Date.now());
		const rows = [geekHeadRow("user", width, stamp)];
		body.forEach((line, index) => {
			const lead = index === 0 ? geekFg("ink", PROMPT) : " ".repeat(safeVisibleWidth(PROMPT));
			rows.push(geekRow("line", lead + geekFg("ink", line), width));
		});
		rows.push(geekRow("line", "", width));
		return keepPromptZone(raw, rows);
	};
}
