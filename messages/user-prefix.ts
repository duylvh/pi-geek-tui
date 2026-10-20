// User prompt rows (spec §2/§3): head row `• bean@proj ~/path (branch)` then `┊ › text`, the body on the panel surface.
import { UserMessageComponent } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";

import { geekHeadRow } from "../presentation/geek-head.js";
import { GEEK_PREFIX_WIDTH, geekRow, geekRowPrefix } from "../presentation/geek-rows.js";
import { loadConfig } from "../config.js";
import { getGlobalImageLink, IMAGE_TOKEN_RE } from "../editor/image-attachments.js";
import { safeVisibleWidth } from "../render-budget.js";
import { dropLeadingColumns, stripAnsi } from "../theme/ansi.js";
import { geekBg, geekFg } from "../theme/geek-palette.js";
import { markRailed } from "./chat-frame.js";
import { keepPromptZone } from "./message-meta.js";

const PATCHED = Symbol.for("pi-geek-tui.user-prefix.patched");
const PROMPT = "› ";
const PAD_RIGHT = 1; // the surface runs to the chat edge; text stops one cell short of it

/**
 * Body row: rail prefix on the page, then `text` padded to the chat edge on the panel surface (spec §3).
 * `text` carries only fg SGR (geekFg resets fg, never bg), so one bg span covers the row.
 */
function surfaceRow(text: string, width: number): string {
	const room = Math.max(0, width - GEEK_PREFIX_WIDTH);
	const body = truncateToWidth(text + " ".repeat(room), room, "");
	return geekRowPrefix("line") + (loadConfig().transparentBackground ? body : geekBg("panel", body));
}

/** Pi's user box is padded 1 column on each side; its background/emphasis give way to plain ink. */
function plainBodyLines(lines: string[]): string[] {
	let first = 0;
	while (first < lines.length && stripAnsi(lines[first] ?? "").trim() === "") first++;
	let last = lines.length - 1;
	while (last > first && stripAnsi(lines[last] ?? "").trim() === "") last--;
	return lines.slice(first, last + 1).map((line) => stripAnsi(dropLeadingColumns(line, 1)).trimEnd());
}

/**
 * Wrap `[Image #N]` tokens in OSC 8 file:// hyperlinks (Cmd+Click). Token ids are monotonic per store,
 * so any rendered token can be linked without knowing which message it came from.
 */
function linkImageTokens(line: string): string {
	if (!line.includes("[Image #")) return line;
	return line.replace(IMAGE_TOKEN_RE, (token, id: string) => {
		const target = getGlobalImageLink(id);
		// Underline marks the link even when the terminal hides OSC 8 styling until hover.
		return target ? `\x1b]8;;file://${target}\x07\x1b[4m${token}\x1b[24m\x1b]8;;\x07` : token;
	});
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
		const bodyWidth = Math.max(1, width - GEEK_PREFIX_WIDTH - PROMPT.length - PAD_RIGHT);
		const raw: string[] = baseRender.call(this, bodyWidth + 2);
		const body = plainBodyLines(raw);
		if (body.length === 0) return [];

		const rows = [geekHeadRow("user", width)];
		body.forEach((line, index) => {
			const lead = index === 0 ? geekFg("ink", PROMPT) : " ".repeat(safeVisibleWidth(PROMPT));
			rows.push(surfaceRow(lead + geekFg("ink", linkImageTokens(line)), width));
		});
		rows.push(geekRow("line", "", width));
		return keepPromptZone(raw, rows);
	};
}
