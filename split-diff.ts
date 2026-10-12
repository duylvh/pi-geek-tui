// Inline diff rows (docs/design/geek-ui-spec.md §6): changed lines on del/add row backgrounds,
// folded unchanged runs as `··· N unchanged lines ···`. Parsing adapted from nielpattin/dotfiles
// diff-renderer.ts for pi-geek-tui.

import { highlightCode } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";

import { safeTruncateToWidth } from "./render-budget.js";
import { geekBg, geekColor, geekFg } from "./theme/geek-palette.js";

// ── Types ──────────────────────────────────────────────────────────

type DiffLine = {
	prefix: "+" | "-" | " ";
	line: string;
	lineNumber: string;
};

type DiffRow = {
	kind: "context" | "changed" | "added" | "removed" | "gap";
	left?: DiffLine;
	right?: DiffLine;
	/** For kind "gap": number of unmodified lines folded away, when known. */
	count?: number;
};

type DiffSpan = { start: number; end: number };

/** Minimum shared-character ratio before a removed/added line pair gets word-level emphasis. */
const WORD_DIFF_MIN_SIMILARITY = 0.35;
/** Mockup block width; clamped to the body width. */
const DIFF_BLOCK_WIDTH = 72;
const DIFF_INDENT = 2;
const MIN_NUMBER_WIDTH = 4;
const EMPHASIS_MIX_RATIO = 0.3;

export type { DiffRow };

// ── ANSI background helpers ────────────────────────────────────────

const BG_ANSI_PATTERN = /\x1b\[(?:4\d|10\d|48;5;\d{1,3}|48;2;\d{1,3};\d{1,3};\d{1,3}|49)m/g;

function keepBackgroundAcrossResets(text: string, rowBgAnsi: string): string {
	if (!text) return text;

	return text.replace(/\x1b\[([0-9;]*)m/g, (sequence, rawCodes) => {
		const split = String(rawCodes ?? "").split(";").filter(Boolean);
		const codes = split.length > 0 ? split : ["0"]; // ESC[m == reset
		const hasGlobalReset = codes.includes("0");
		const hasBgReset = codes.includes("49");
		if (!hasGlobalReset && !hasBgReset) {
			return sequence;
		}

		const rebuiltCodes = codes.filter((code: string) => code !== "49");
		const rebuilt = rebuiltCodes.length > 0 ? `\x1b[${rebuiltCodes.join(";")}m` : "";
		return `${rebuilt}${rowBgAnsi}`;
	});
}

function applyBackgroundToVisibleRange(
	ansiText: string,
	start: number,
	end: number,
	backgroundAnsi: string,
	restoreBackgroundAnsi: string,
): string {
	if (!ansiText || start >= end || end <= 0) return ansiText;

	let output = "";
	let visibleIndex = 0;
	let index = 0;
	let inRange = false;

	while (index < ansiText.length) {
		if (ansiText[index] === "\x1b") {
			const sequenceEnd = ansiText.indexOf("m", index);
			if (sequenceEnd !== -1) {
				output += ansiText.slice(index, sequenceEnd + 1);
				index = sequenceEnd + 1;
				continue;
			}
		}

		if (visibleIndex === start && !inRange) {
			output += backgroundAnsi;
			inRange = true;
		}
		if (visibleIndex === end && inRange) {
			output += restoreBackgroundAnsi;
			inRange = false;
		}

		output += ansiText[index] ?? "";
		visibleIndex++;
		index++;
	}

	if (inRange) output += restoreBackgroundAnsi;
	return output;
}

/**
 * Highlighted code leaves identifiers/operators without a color, so they would fall back to the
 * terminal default. Make ink the base: set it first and re-set it after every fg/full reset.
 */
export function inkBase(text: string): string {
	const ink = geekFg("ink", "").slice(0, -"\x1b[39m".length);
	return ink + text.replace(/\x1b\[(?:39|0)m/g, (reset) => reset + ink);
}

// ── Text utilities ─────────────────────────────────────────────────

function sanitizeSingleLineText(value: string): string {
	return value.replace(/\r/g, "").replace(/\n/g, "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

function stripInlineBreaksPreserveAnsi(value: string): string {
	return value.replace(/\r/g, "").replace(/\n/g, "");
}

function wrapPlainText(text: string, width: number): string[] {
	const safeWidth = Math.max(1, width);
	const safeText = sanitizeSingleLineText(text);
	if (!safeText) return [""];

	const lines: string[] = [];
	let cursor = 0;

	while (cursor < safeText.length) {
		const remaining = safeText.length - cursor;
		if (remaining <= safeWidth) {
			lines.push(safeText.slice(cursor));
			break;
		}

		const window = safeText.slice(cursor, cursor + safeWidth);
		const breakOnSpace = window.lastIndexOf(" ");

		if (breakOnSpace > 0) {
			const next = breakOnSpace + 1; // keep the space so offsets stay stable for inline diff spans
			lines.push(safeText.slice(cursor, cursor + next));
			cursor += next;
			continue;
		}

		// Fallback for long uninterrupted tokens (paths, hashes, etc.)
		lines.push(window);
		cursor += safeWidth;
	}

	return lines.length > 0 ? lines : [""];
}

// ── Diff parsing ───────────────────────────────────────────────────

function parseLineNumber(value: string): number | undefined {
	const trimmed = value.trim();
	if (!/^\d+$/.test(trimmed)) return undefined;
	const parsed = Number.parseInt(trimmed, 10);
	return Number.isFinite(parsed) ? parsed : undefined;
}

function makeDiffLine(prefix: "+" | "-" | " ", lineNumber: string | number | undefined, line: string): DiffLine {
	return {
		prefix,
		lineNumber: lineNumber === undefined ? "" : String(lineNumber),
		line,
	};
}

function parseDiffLine(rawLine: string, parseGutter = true): DiffLine | undefined {
	// Unified hunks have no gutter column — the char after the prefix is
	// content, so a leading "NN " there must not be eaten as a line number.
	const match = rawLine.match(parseGutter ? /^([+\- ])\s?(.*)$/ : /^([+\- ])(.*)$/);
	if (!match) return undefined;
	const [, prefix, rest = ""] = match;
	if (prefix !== "+" && prefix !== "-" && prefix !== " ") return undefined;

	const gutterMatch = parseGutter ? rest.match(/^(\d+)\s(.*)$/) : null;
	const lineNumber = gutterMatch?.[1] ?? "";
	const line = gutterMatch?.[2] ?? rest;
	const cleanLineNumber = sanitizeSingleLineText(lineNumber);
	const cleanLine = sanitizeSingleLineText(line).replace(/\t/g, "    ");
	return { prefix, lineNumber: cleanLineNumber, line: cleanLine };
}

function computeInlineDiffSpans(leftLine: string, rightLine: string): { left: DiffSpan[]; right: DiffSpan[] } {
	if (leftLine === rightLine) return { left: [], right: [] };
	let start = 0;
	const minLen = Math.min(leftLine.length, rightLine.length);
	while (start < minLen && leftLine[start] === rightLine[start]) start++;

	let leftEnd = leftLine.length;
	let rightEnd = rightLine.length;
	while (leftEnd > start && rightEnd > start && leftLine[leftEnd - 1] === rightLine[rightEnd - 1]) {
		leftEnd--;
		rightEnd--;
	}

	// Similarity floor: when a removed/added pair shares little more than
	// coincidence, word-level emphasis would just tint most of both lines.
	// Treat such pairs as full rewrites and skip the emphasis (same idea as
	// deepagents' word-diff similarity floor).
	const unchanged = start + (leftLine.length - leftEnd);
	const similarity = unchanged / Math.max(leftLine.length, rightLine.length, 1);
	if (similarity < WORD_DIFF_MIN_SIMILARITY) return { left: [], right: [] };

	const leftSpan = leftEnd > start ? [{ start, end: leftEnd }] : [];
	const rightSpan = rightEnd > start ? [{ start, end: rightEnd }] : [];
	return { left: leftSpan, right: rightSpan };
}

// ── Exported helpers ───────────────────────────────────────────────

export function buildDiffRows(diff: string): DiffRow[] {
	const rows: DiffRow[] = [];
	let pendingLeft: DiffLine[] = [];
	let pendingRight: DiffLine[] = [];
	let oldCursor: number | undefined;
	let newCursor: number | undefined;

	const flushPending = () => {
		while (pendingLeft.length > 0 || pendingRight.length > 0) {
			const left = pendingLeft.shift();
			const right = pendingRight.shift();
			if (left && right) rows.push({ kind: "changed", left, right });
			else if (left) rows.push({ kind: "removed", left });
			else if (right) rows.push({ kind: "added", right });
		}
	};

	// Unified-patch mode: @@ hunk headers seed the line-number cursors.
	let unifiedHunks = false;
	// Gap row from Pi's "..." skip marker; its count comes from the next numbered context line.
	let openGap: DiffRow | undefined;

	for (const rawLine of diff.split("\n")) {
		const hunk = rawLine.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
		if (hunk) {
			flushPending();
			const hunkOldStart = Number.parseInt(hunk[1], 10);
			// Folded context between hunks: emit a gap row so disjoint
			// changes are not mistaken for adjacent lines.
			if (oldCursor !== undefined && hunkOldStart > oldCursor) {
				rows.push({ kind: "gap", count: hunkOldStart - oldCursor });
			}
			oldCursor = hunkOldStart;
			newCursor = Number.parseInt(hunk[2], 10);
			unifiedHunks = true;
			continue;
		}

		const parsed = parseDiffLine(rawLine, !unifiedHunks);
		if (!parsed) continue;

		// Pi's gutter diffs mark folded context with an unnumbered "..." line.
		if (!unifiedHunks && parsed.prefix === " " && !parsed.lineNumber && parsed.line.trim() === "...") {
			flushPending();
			openGap = { kind: "gap" };
			rows.push(openGap);
			continue;
		}

		const parsedNum = parseLineNumber(parsed.lineNumber);
		if (parsed.prefix === "-") {
			const oldNum = parsedNum ?? oldCursor;
			if (oldNum !== undefined) oldCursor = oldNum + 1;
			pendingLeft.push(makeDiffLine("-", oldNum, parsed.line));
			continue;
		}
		if (parsed.prefix === "+") {
			const newNum = parsedNum ?? newCursor;
			if (newNum !== undefined) newCursor = newNum + 1;
			pendingRight.push(makeDiffLine("+", newNum, parsed.line));
			continue;
		}

		flushPending();

		// Gutter-numbered diffs without @@ headers: detect folded context
		// from line-number jumps on context lines. Folded lines are unchanged,
		// so the new-side cursor skips the same count.
		if (!unifiedHunks && parsedNum !== undefined && oldCursor !== undefined && parsedNum > oldCursor) {
			const count = parsedNum - oldCursor;
			if (openGap) openGap.count = count;
			else rows.push({ kind: "gap", count });
			if (newCursor !== undefined) newCursor += count;
		}
		openGap = undefined;
		const oldNum = parsedNum ?? oldCursor;
		const newNum = newCursor ?? oldNum;
		if (oldNum !== undefined) oldCursor = oldNum + 1;
		if (newNum !== undefined) newCursor = newNum + 1;

		rows.push({
			kind: "context",
			left: makeDiffLine(" ", oldNum, parsed.line),
			right: makeDiffLine(" ", newNum, parsed.line),
		});
	}

	flushPending();
	return rows;
}

export function countDiffStats(diff: string): { additions: number; removals: number } {
	let additions = 0;
	let removals = 0;
	for (const line of diff.split("\n")) {
		if (line.startsWith("+++") || line.startsWith("---")) continue;
		if (line.startsWith("+")) additions += 1;
		if (line.startsWith("-")) removals += 1;
	}
	return { additions, removals };
}

export function extractEditedPath(message: string): string | undefined {
	const m = message.match(/Successfully replaced (?:text|\d+ block\(s\)|lines L\d+-\d+) in (.+)\.$/);
	return m?.[1];
}

export function firstText(content: Array<{ type: string; text?: string }>): string {
	for (const part of content) {
		if (part.type === "text" && typeof part.text === "string") {
			return part.text;
		}
	}
	return "";
}


/** All-added rows for a file written from scratch. */
export function buildAddedRows(content: string): DiffRow[] {
	const lines = content.replace(/\r/g, "").replace(/\n$/, "").split("\n");
	return lines.map((line, index) => ({ kind: "added", right: makeDiffLine("+", index + 1, sanitizeSingleLineText(line).replace(/\t/g, "    ")) }));
}

// ── DiffRowsComponent ──────────────────────────────────────────────

type Side = "add" | "del";
type Shown = { side: Side; line: DiffLine } | { gap: number | undefined };

/**
 * Hunks as the spec shows them: removed lines then added lines, unchanged runs folded into a gap
 * row between hunks. Context before the first / after the last change is dropped.
 */
function foldRows(rows: DiffRow[]): Shown[] {
	const shown: Shown[] = [];
	let unchanged = 0;
	let unknownGap = false;
	let changed = false;
	for (let i = 0; i < rows.length; i++) {
		const row = rows[i]!;
		if (row.kind === "context") {
			unchanged++;
			continue;
		}
		if (row.kind === "gap") {
			if (row.count === undefined) unknownGap = true;
			else unchanged += row.count;
			continue;
		}
		if (changed && (unchanged > 0 || unknownGap)) shown.push({ gap: unknownGap && unchanged === 0 ? undefined : unchanged });
		unchanged = 0;
		unknownGap = false;
		changed = true;
		const run: DiffRow[] = [row];
		while (i + 1 < rows.length && rows[i + 1]!.kind !== "context" && rows[i + 1]!.kind !== "gap") run.push(rows[++i]!);
		for (const r of run) if (r.left) shown.push({ side: "del", line: r.left });
		for (const r of run) if (r.right) shown.push({ side: "add", line: r.right });
	}
	return shown;
}

function rowBgStart(role: "delBg" | "addBg"): string {
	return geekBg(role, "").slice(0, -"\x1b[49m".length);
}

function emphasisBgStart(role: "delBg" | "addBg", marker: "delMark" | "addMark"): string {
	const mix = (offset: number) => {
		const base = parseInt(geekColor(role).slice(offset, offset + 2), 16);
		const tint = parseInt(geekColor(marker).slice(offset, offset + 2), 16);
		return Math.round(base + (tint - base) * EMPHASIS_MIX_RATIO);
	};
	return `\x1b[48;2;${mix(1)};${mix(3)};${mix(5)}m`;
}

export class DiffRowsComponent implements Component {
	private cacheWidth?: number;
	private cacheLines?: string[];
	private readonly shown: Shown[];
	private readonly numberWidth: number;
	private readonly inlineSpans = new WeakMap<DiffLine, DiffSpan[]>();
	private readonly highlightCache = new Map<string, string>();

	constructor(
		rows: DiffRow[],
		private readonly maxRows: number,
		private readonly language?: string,
	) {
		this.shown = foldRows(rows);
		let digits = MIN_NUMBER_WIDTH;
		for (const row of rows) {
			digits = Math.max(digits, row.left?.lineNumber.trim().length ?? 0, row.right?.lineNumber.trim().length ?? 0);
			if (row.kind === "changed" && row.left && row.right) {
				const spans = computeInlineDiffSpans(row.left.line, row.right.line);
				if (spans.left.length > 0) this.inlineSpans.set(row.left, spans.left);
				if (spans.right.length > 0) this.inlineSpans.set(row.right, spans.right);
			}
		}
		this.numberWidth = digits;
	}

	private highlight(line: string): string {
		if (!this.language) return inkBase(line);
		const key = `${this.language}\n${line}`;
		const cached = this.highlightCache.get(key);
		if (cached) return cached;
		let highlighted = line;
		try {
			highlighted = stripInlineBreaksPreserveAnsi(highlightCode(line, this.language)[0] ?? line).replace(BG_ANSI_PATTERN, "");
		} catch {
			// plain text
		}
		highlighted = inkBase(highlighted);
		this.highlightCache.set(key, highlighted);
		return highlighted;
	}

	private formatLine(side: Side, line: DiffLine, blockWidth: number): string[] {
		const bgRole = side === "add" ? "addBg" : "delBg";
		const markRole = side === "add" ? "addMark" : "delMark";
		const rowBg = rowBgStart(bgRole);
		const spanBg = emphasisBgStart(bgRole, markRole);
		const prefixWidth = this.numberWidth + 1 + 2;
		const codeWidth = Math.max(1, blockWidth - prefixWidth);
		const segments = wrapPlainText(line.line, codeWidth);
		const spans = this.inlineSpans.get(line) ?? [];
		const rows: string[] = [];
		let consumed = 0;
		segments.forEach((plain, index) => {
			let code = this.highlight(plain);
			for (let s = spans.length - 1; s >= 0; s--) {
				const start = Math.max(0, spans[s]!.start - consumed);
				const end = Math.min(plain.length, spans[s]!.end - consumed);
				if (end > start) code = applyBackgroundToVisibleRange(code, start, end, spanBg, rowBg);
			}
			consumed += plain.length;
			const number = index === 0 ? line.lineNumber.trim().padStart(this.numberWidth) : " ".repeat(this.numberWidth);
			const marker = index === 0 ? (side === "add" ? "+ " : "- ") : "  ";
			const inner = `${geekFg("faint", `${number} `)}${geekFg(markRole, marker)}${safeTruncateToWidth(code, codeWidth, "…", true)}`;
			rows.push(`${" ".repeat(DIFF_INDENT)}${rowBg}${keepBackgroundAcrossResets(inner, rowBg)}\x1b[49m`);
		});
		return rows;
	}

	render(width: number): string[] {
		if (this.cacheWidth === width && this.cacheLines) return this.cacheLines;
		const blockWidth = Math.max(this.numberWidth + 8, Math.min(DIFF_BLOCK_WIDTH, width - DIFF_INDENT));
		const gapIndent = " ".repeat(DIFF_INDENT + this.numberWidth + 1 + 2);
		const lines: string[] = [];
		let used = 0;
		for (; used < this.shown.length && lines.length < this.maxRows; used++) {
			const item = this.shown[used]!;
			if ("gap" in item) {
				const label = item.gap === undefined ? "··· unchanged lines ···" : `··· ${item.gap} unchanged lines ···`;
				lines.push(geekFg("faint", `${gapIndent}${label}`));
			} else {
				lines.push(...this.formatLine(item.side, item.line, blockWidth));
			}
		}
		if (used < this.shown.length) lines.push(geekFg("faint", `${gapIndent}… ${this.shown.length - used} more rows`));
		this.cacheWidth = width;
		this.cacheLines = lines;
		return lines;
	}

	invalidate(): void {
		this.cacheWidth = undefined;
		this.cacheLines = undefined;
		this.highlightCache.clear();
	}
}
