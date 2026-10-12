import { CustomEditor } from "@earendil-works/pi-coding-agent";
import { CURSOR_MARKER } from "@earendil-works/pi-tui";
import { homedir, userInfo } from "node:os";
import { basename } from "node:path";

import { loadConfig } from "../config.js";
import type { FooterTokenUsage } from "../footer-patch.js";
import { GEEK_GUTTER_WIDTH, GEEK_PREFIX_WIDTH, geekHeadBody, geekRow, geekSplitRow } from "../presentation/geek-rows.js";
import { safeTruncateToWidth, safeVisibleWidth, safeWrapTextWithAnsi } from "../render-budget.js";
import { stripAnsi } from "../theme/ansi.js";
import { geekBg, geekFg } from "../theme/geek-palette.js";
import { getLiveState } from "./live-state.js";
import { shimmerWord } from "./shimmer.js";

type ContextUsage = { tokens: number | null; percent: number | null; contextWindow: number };
type ModelInfo = { provider?: string; id?: string; reasoning?: boolean; thinkingLevel?: string };
type BranchInfo = { branch: string };
export interface GeekEditorProviders {
	cwd: string;
	getContextUsage(): ContextUsage | undefined;
	getModelInfo(): ModelInfo | undefined;
	getBranch(): BranchInfo | null;
	getFooterStatus(): string | null;
	getTokenUsage(): FooterTokenUsage | null;
}

type SlashItem = { value?: string; label?: string; description?: string };

const BAR_CELLS = 16;
const TICK_MS = 70; // smooth shimmer sweep; the ticker only runs while the agent is live
const PROMPT = "› ";

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function oneLine(text: string): string {
	return text.replace(/[\r\n]+/g, " ").trim();
}

function firstCodePoint(text: string): string {
	const next = text[Symbol.iterator]().next();
	return next.done ? "" : next.value;
}

function isBorderLine(line: string): boolean {
	const clean = stripAnsi(line).replace(/\s/g, "");
	return clean.replace(/─/g, "").replace(/[↑↓]\s*\d+\s*more/g, "") === "";
}

function findLastBorderIndex(lines: string[]): number {
	for (let i = lines.length - 1; i >= 0; i--) if (isBorderLine(lines[i] ?? "")) return i;
	return -1;
}

function compact(count: number): string {
	if (count < 1000) return String(Math.round(count));
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
}

function username(): string {
	try {
		return userInfo().username || process.env.USER || "user";
	} catch {
		return process.env.USER || process.env.LOGNAME || "user";
	}
}

function displayCwd(cwd: string): string {
	const home = homedir().replace(/\\/g, "/");
	const normalized = (cwd || process.cwd()).replace(/\\/g, "/");
	return normalized === home || normalized.startsWith(`${home}/`) ? `~${normalized.slice(home.length)}` : normalized;
}

function bar(percent: number | null): string {
	const filled = percent === null ? 0 : clamp(Math.round((percent / 100) * BAR_CELLS), 0, BAR_CELLS);
	return geekFg("kw", "█".repeat(filled)) + geekFg("faint", "░".repeat(BAR_CELLS - filled));
}

/** Label in the 5-col gutter column, then 3 blank rail cells, then the body (spec §9). */
function labelRow(label: string, body: string, width: number): string {
	const cell = " ".repeat(Math.max(0, GEEK_GUTTER_WIDTH - label.length)) + geekFg("dim", label);
	return safeTruncateToWidth(`${cell}   ${body}`, width, "", true);
}

export class GeekEditor extends CustomEditor {
	private ticker: ReturnType<typeof setInterval> | undefined;
	private readonly renderHost: any;
	private readonly user = username();

	constructor(tui: any, editorTheme: any, kb: any, private readonly providers: GeekEditorProviders) {
		super(tui, editorTheme, kb);
		this.renderHost = tui;
	}

	private shownWord = "";
	private wordChangedAt = 0;

	// Repaint while the agent is live (shimmer + seconds); stops itself once the run is over.
	private syncTicker(): void {
		const live = getLiveState() !== undefined;
		if (live && !this.ticker) {
			this.ticker = setInterval(() => this.renderHost?.requestRender?.(), TICK_MS);
			this.ticker.unref?.();
		} else if (!live && this.ticker) {
			clearInterval(this.ticker);
			this.ticker = undefined;
		}
	}

	private liveStateText(): string {
		const live = getLiveState();
		if (!live) {
			this.shownWord = ""; // the next run decodes its first word in again
			return "";
		}
		const word = loadConfig().customWorkingMessage[live.name];
		const secs = (live.elapsedMs / 1000).toFixed(1);
		const now = Date.now();
		if (word !== this.shownWord) {
			this.shownWord = word;
			this.wordChangedAt = now;
		}
		return `${shimmerWord(word, now, this.wordChangedAt)}${geekFg("dim", " · ")}${geekFg("num", secs)}${geekFg("dim", "s")}`;
	}

	private headRow(width: number): string {
		const branch = this.providers.getBranch()?.branch;
		const left = geekHeadBody({ name: this.user, host: basename(this.providers.cwd) || "host", cwd: displayCwd(this.providers.cwd), branch });
		const body = geekSplitRow(left, this.liveStateText(), Math.max(1, width - GEEK_PREFIX_WIDTH));
		return geekRow("head-user", body, width);
	}

	private renderInputLines(text: string, width: number): string[] {
		const logical = text.length > 0 ? text.split("\n") : [""];
		const cursor = this.getCursor();
		const cursorLine = clamp(cursor.line, 0, logical.length - 1);
		const wrapWidth = Math.max(1, width - GEEK_PREFIX_WIDTH - PROMPT.length);
		const rows: string[] = [];
		for (let i = 0; i < logical.length; i++) {
			let line = logical[i] ?? "";
			if (i === cursorLine) {
				const col = clamp(cursor.col, 0, line.length);
				const after = line.slice(col);
				const glyph = firstCodePoint(after);
				const block = geekBg("ink", geekFg("bg", glyph || " "));
				line = `${line.slice(0, col)}${this.focused ? CURSOR_MARKER : ""}${block}${glyph ? after.slice(glyph.length) : after}`;
			}
			const wrapped = safeWrapTextWithAnsi(line, wrapWidth);
			rows.push(...(wrapped.length > 0 ? wrapped : [""]));
		}
		return rows.map((row, index) => {
			const prompt = index === 0 ? geekFg("ink", PROMPT) : " ".repeat(PROMPT.length);
			return geekRow("blank", `${prompt}${row}`, width);
		});
	}

	private slashItems(): { items: SlashItem[]; selected: number; maxVisible: number; withSlash: boolean } | null {
		const state = (this as any).state as { lines?: string[]; cursorLine?: number; cursorCol?: number } | undefined;
		if (!state || !Array.isArray(state.lines)) return null;
		const line = state.lines[state.cursorLine ?? 0] ?? "";
		const before = line.slice(0, Math.max(0, state.cursorCol ?? 0)).trimStart();
		if ((state.cursorLine ?? 0) !== 0 || !before.startsWith("/")) return null;
		const list = (this as any).autocompleteList as { filteredItems?: SlashItem[]; selectedIndex?: number; maxVisible?: number } | undefined;
		if (!(this as any).autocompleteState || !list) return null;
		const items = Array.isArray(list.filteredItems) ? list.filteredItems : [];
		return {
			items,
			selected: clamp(list.selectedIndex ?? 0, 0, Math.max(0, items.length - 1)),
			maxVisible: clamp(list.maxVisible ?? 6, 1, 20),
			withSlash: !before.includes(" "),
		};
	}

	private slashRows(width: number): string[] | null {
		const model = this.slashItems();
		if (!model) return null;
		const start = Math.max(0, Math.min(model.selected - Math.floor(model.maxVisible / 2), Math.max(0, model.items.length - model.maxVisible)));
		const visible = model.items.slice(start, start + model.maxVisible);
		const rows = visible.map((item, i) => {
			const selected = start + i === model.selected;
			const raw = oneLine(item.label || item.value || "");
			const command = model.withSlash && raw && !raw.startsWith("/") ? `/${raw}` : raw;
			const padded = command + " ".repeat(Math.max(1, 24 - safeVisibleWidth(command)));
			const description = oneLine(item.description ?? "");
			const marker = selected ? geekFg("accent", "▸ ") : "  ";
			return geekRow("blank", `${marker}${geekFg(selected ? "ink" : "dim", padded)}${geekFg(selected ? "dim" : "faint", description)}`, width);
		});
		if (rows.length === 0) rows.push(geekRow("blank", geekFg("faint", "  no matching commands"), width));
		const shown = visible.length > 0 ? `${start + 1}-${start + visible.length}/${model.items.length}` : "0/0";
		rows.push(geekRow("blank", geekFg("faint", `  ↑↓ navigate · tab/enter select · esc cancel · ${shown}`), width));
		return rows;
	}

	private contextRow(width: number): string {
		const usage = this.providers.getContextUsage();
		const percent = usage && usage.contextWindow
			? (typeof usage.percent === "number" && Number.isFinite(usage.percent)
				? usage.percent
				: typeof usage.tokens === "number" ? (usage.tokens / usage.contextWindow) * 100 : null)
			: null;
		const figures = percent === null
			? geekFg("dim", "–")
			: `${geekFg("num", percent.toFixed(1))}${geekFg("dim", `%/${compact(usage!.contextWindow)}`)}`;
		const info = this.providers.getModelInfo();
		let model = "";
		if (info?.id) {
			model = (info.provider ? geekFg("faint", `(${info.provider}) `) : "") + geekFg("ink", info.id);
			if (info.reasoning && info.thinkingLevel) model += geekFg("dim", " · ") + geekFg("kw", info.thinkingLevel);
		}
		return labelRow("ctx", geekSplitRow(`${bar(percent)}  ${figures}`, model, Math.max(1, width - GEEK_PREFIX_WIDTH)), width);
	}

	private tokenRow(width: number): string {
		const usage = this.providers.getTokenUsage();
		let left = "";
		let cost = "";
		if (usage) {
			const unit = (mark: string, value: string) => `${geekFg("dim", mark)}${geekFg("num", value)}`;
			left = [
				`${unit("↑", compact(usage.input))} ${unit("↓", compact(usage.output))}`,
				`${unit("R", compact(usage.cacheRead))} ${unit("W", compact(usage.cacheWrite))}`,
				`${geekFg("dim", "CH ")}${geekFg("num", usage.cacheHitPercent.toFixed(1))}${geekFg("dim", "%")}`,
			].join("  ");
			cost = geekFg("num", `$${usage.cost.toFixed(3)}`);
		}
		return labelRow("tok", geekSplitRow(left, cost, Math.max(1, width - GEEK_PREFIX_WIDTH)), width);
	}

	render(width: number): string[] {
		const bodyWidth = Math.max(1, width - GEEK_PREFIX_WIDTH - PROMPT.length);
		const parentLines = super.render(bodyWidth);
		if (parentLines.length === 0) return parentLines;
		const border = findLastBorderIndex(parentLines);
		const parentAutocomplete = border >= 0 ? parentLines.slice(border + 1) : [];

		const autocomplete = this.slashRows(width)
			?? parentAutocomplete.map((line) => geekRow("blank", line, width));
		const status = oneLine(stripAnsi(this.providers.getFooterStatus() ?? ""));

		const lines = [
			this.headRow(width),
			...this.renderInputLines(this.getText(), width),
			...autocomplete,
			"",
			geekFg("rule", "─".repeat(Math.max(1, width))),
			this.contextRow(width),
			this.tokenRow(width),
			...(status ? [labelRow("", geekFg("dim", status), width)] : []),
		];
		this.syncTicker();
		return lines;
	}
}
