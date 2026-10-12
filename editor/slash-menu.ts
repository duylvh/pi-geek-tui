// Slash-command popup (mockup A3): a pure renderer. The caller decides where the rows go
// (intended order: between the transcript and the input head row, above the `• user@project` line).

import { truncateToWidth as safeTruncateToWidth, visibleWidth as safeVisibleWidth } from "@earendil-works/pi-tui";
import { GEEK_PREFIX_WIDTH } from "../presentation/geek-rows.js";
import { geekBg, geekFg } from "../theme/geek-palette.js";

export type SlashMenuItem = { value?: string; label?: string; description?: string };

export type SlashMenuModel = {
	items: SlashMenuItem[];
	selected: number;
	maxVisible: number;
	/** Prefix a missing `/` (user is still typing the command name). */
	withSlash: boolean;
};

const MARKER_WIDTH = 2;
const MIN_COMMAND_COLUMN = 10;
const MAX_COMMAND_COLUMN = 20;
const HINT_TEXT = " ↑↓ select · tab fill · ↩ run · esc close";

function oneLine(text: string | undefined): string {
	return (text ?? "").replace(/[\r\n]+/g, " ").trim();
}

function commandName(item: SlashMenuItem, withSlash: boolean): string {
	const raw = oneLine(item.label || item.value);
	return withSlash && raw && !raw.startsWith("/") ? `/${raw}` : raw;
}

/**
 * Rows exactly `width` cells wide: 8 blank prefix cells (gutter + rail stay empty), then a panel
 * with its own background on every row.
 * `hints` (optional) appends live info to a command's description: `{ "/model": "now opus-5-5" }`.
 */
export function renderSlashMenu(model: SlashMenuModel, width: number, hints: Record<string, string> = {}): string[] {
	const total = Math.max(0, Math.floor(width));
	const prefix = " ".repeat(Math.min(GEEK_PREFIX_WIDTH, total));
	const panelWidth = Math.max(0, total - prefix.length);
	if (panelWidth === 0) return [];

	const count = model.items.length;
	const selected = count === 0 ? 0 : Math.max(0, Math.min(model.selected, count - 1));
	const visibleCount = Math.max(1, Math.floor(model.maxVisible));
	const start = Math.max(0, Math.min(selected - Math.floor(visibleCount / 2), Math.max(0, count - visibleCount)));
	const visible = model.items.slice(start, start + visibleCount);

	// `surface` is the row background role; every styled piece resets only fg, so the bg survives.
	const row = (surface: "panel" | "panelSel", content: string): string => {
		const clipped = safeTruncateToWidth(content, panelWidth, "");
		const pad = " ".repeat(Math.max(0, panelWidth - safeVisibleWidth(clipped)));
		return prefix + geekBg(surface, clipped + pad);
	};

	const rows: string[] = [];

	const counter = `${count === 0 ? 0 : selected + 1}/${count} `;
	const label = " commands";
	const gap = Math.max(1, panelWidth - safeVisibleWidth(label) - counter.length);
	rows.push(row("panel", `${geekFg("dim", label)}${" ".repeat(gap)}${geekFg("faint", counter)}`));

	if (visible.length === 0) {
		rows.push(row("panel", geekFg("faint", " no matching commands")));
	} else {
		const names = visible.map((item) => commandName(item, model.withSlash));
		const longest = Math.max(...names.map((name) => safeVisibleWidth(name)));
		const column = Math.max(MIN_COMMAND_COLUMN, Math.min(MAX_COMMAND_COLUMN, longest + 2));
		visible.forEach((item, i) => {
			const isSelected = start + i === selected;
			const name = safeTruncateToWidth(names[i]!, column - 1, "…");
			const hint = hints[names[i]!];
			const description = [oneLine(item.description), hint].filter(Boolean).join(" · ");
			const room = Math.max(0, panelWidth - MARKER_WIDTH - column);
			const marker = isSelected ? geekFg("accent", "› ") : "  ";
			const command = geekFg(isSelected ? "accent" : "ink", name) + " ".repeat(Math.max(0, column - safeVisibleWidth(name)));
			const text = room > 0 ? geekFg("dim", safeTruncateToWidth(description, room, "…")) : "";
			rows.push(row(isSelected ? "panelSel" : "panel", marker + command + text));
		});
	}

	rows.push(row("panel", geekFg("faint", HINT_TEXT)));
	return rows;
}
