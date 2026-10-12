// Shared row grammar (docs/design/geek-ui-spec.md "Layout grammar"):
// row = gutter(5, right-aligned HH:MM) + rail(3, centered glyph) + body.
// Owner after split: conversation scope. Tools + frame scopes call these, never re-implement them.

export const GEEK_GUTTER_WIDTH = 5;
export const GEEK_RAIL_WIDTH = 3;
export const GEEK_PREFIX_WIDTH = GEEK_GUTTER_WIDTH + GEEK_RAIL_WIDTH;

/** head = `•` (ink for user, kw for agent); line = `│` rail color; active = `┃` accent; blank = space. */
export type GeekRail = "head-user" | "head-agent" | "line" | "active" | "blank";

/** Gutter + rail prefix, exactly GEEK_PREFIX_WIDTH visible cells. `time` only on head rows. */
export function geekRowPrefix(rail: GeekRail, time?: string): string {
	throw new Error("not implemented: geekRowPrefix (conversation scope)");
}

/** Prefix + body, truncated/padded to `width` visible cells. */
export function geekRow(rail: GeekRail, body: string, width: number, time?: string): string {
	throw new Error("not implemented: geekRow (conversation scope)");
}

/** Left body + right-aligned meta inside `width` body cells (truncates left first). */
export function geekSplitRow(left: string, right: string, width: number): string {
	throw new Error("not implemented: geekSplitRow (conversation scope)");
}

export type GeekHeadInfo = { name: string; host: string; cwd: string; branch?: string };

/** `bean@kpi-api ~/code/kpi-api (fix/refresh-ttl)` styled per spec §2. */
export function geekHeadBody(info: GeekHeadInfo): string {
	throw new Error("not implemented: geekHeadBody (conversation scope)");
}

/** `1'204` grouping, as hancore. */
export function geekNumber(value: number): string {
	throw new Error("not implemented: geekNumber (conversation scope)");
}
