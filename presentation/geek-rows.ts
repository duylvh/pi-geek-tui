// Shared row grammar (docs/design/geek-ui-spec.md "Layout grammar"):
// row = gutter(5, right-aligned HH:MM) + rail(3, centered glyph) + body.
// Owner after split: conversation scope. Tools + frame scopes call these, never re-implement them.

import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { GEEK_PALETTE, geekFg } from "../theme/geek-palette.js";

export const GEEK_GUTTER_WIDTH = 5;
export const GEEK_RAIL_WIDTH = 3;
export const GEEK_PREFIX_WIDTH = GEEK_GUTTER_WIDTH + GEEK_RAIL_WIDTH;

/**
 * head = `•` (ink for user, kw for agent); line = `│` rail color; blank = space. Tool-block rows use `┃`:
 * active = accent (running), tool-ok = kw (finished), tool-error = del marker (a call failed).
 */
export type GeekRail = "head-user" | "head-agent" | "line" | "active" | "tool-ok" | "tool-error" | "blank";

// Spec: gutter time is `dim @55%`. Terminals have no alpha, so pre-blend dim over bg once.
function blendedDimRgb(alpha: number): string {
	const channel = (offset: number) => {
		const fg = parseInt(GEEK_PALETTE.dim.slice(offset, offset + 2), 16);
		const bg = parseInt(GEEK_PALETTE.bg.slice(offset, offset + 2), 16);
		return Math.round(bg + (fg - bg) * alpha);
	};
	return `${channel(1)};${channel(3)};${channel(5)}`;
}
const GUTTER_RGB = blendedDimRgb(0.55);

function gutterCell(time?: string): string {
	const label = time ? truncateToWidth(time, GEEK_GUTTER_WIDTH, "") : "";
	if (!label) return " ".repeat(GEEK_GUTTER_WIDTH);
	return `${" ".repeat(GEEK_GUTTER_WIDTH - visibleWidth(label))}\x1b[38;2;${GUTTER_RGB}m${label}\x1b[39m`;
}

function railGlyph(rail: GeekRail): string {
	switch (rail) {
		case "head-user":
			return geekFg("ink", "•");
		case "head-agent":
			return geekFg("kw", "•");
		case "line":
			return geekFg("rail", "│");
		case "active":
			return geekFg("accent", "┃");
		case "tool-ok":
			return geekFg("kw", "┃");
		case "tool-error":
			return geekFg("delMark", "┃");
		case "blank":
			return " ";
	}
}

/** Gutter + rail prefix, exactly GEEK_PREFIX_WIDTH visible cells. `time` only on head rows. */
export function geekRowPrefix(rail: GeekRail, time?: string): string {
	return `${gutterCell(time)} ${railGlyph(rail)} `;
}

/** Prefix + body, truncated/padded to `width` visible cells. */
export function geekRow(rail: GeekRail, body: string, width: number, time?: string): string {
	const total = Math.max(0, Math.floor(width));
	const line = geekRowPrefix(rail, time) + body;
	return truncateToWidth(line, total, "", true);
}

/** Left body + right-aligned meta inside `width` body cells (truncates left first). */
export function geekSplitRow(left: string, right: string, width: number): string {
	const total = Math.max(0, Math.floor(width));
	const rightWidth = visibleWidth(right);
	if (rightWidth >= total) return truncateToWidth(right, total, "", true);
	const leftRoom = total - rightWidth - (rightWidth > 0 ? 1 : 0);
	const fitted = truncateToWidth(left, leftRoom, "…", true);
	return rightWidth > 0 ? `${fitted} ${right}` : fitted;
}

export type GeekHeadInfo = { name: string; host: string; cwd: string; branch?: string };

/** `bean@kpi-api ~/code/kpi-api (fix/refresh-ttl)` styled per spec §2. */
export function geekHeadBody(info: GeekHeadInfo): string {
	const parts = [`${geekFg("ink", info.name)}${geekFg("dim", `@${info.host}`)}`, geekFg("punct", info.cwd)];
	if (info.branch) parts.push(geekFg("kw", `(${info.branch})`));
	return parts.join(" ");
}

/** `1'204` grouping, as hancore. */
export function geekNumber(value: number): string {
	const sign = value < 0 ? "-" : "";
	const digits = String(Math.trunc(Math.abs(value)));
	const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, "'");
	const fraction = Number.isInteger(value) ? "" : String(Math.abs(value)).replace(/^\d+(?=\.)/, "");
	return `${sign}${grouped}${fraction}`;
}
