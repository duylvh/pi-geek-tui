import { geekNumber, geekRow } from "../presentation/geek-rows.js";
import type { GeekRail } from "../presentation/geek-rows.js";
import { safeTruncateToWidth, safeVisibleWidth } from "../render-budget.js";
import { stripAnsi } from "../theme/ansi.js";
import { type GeekColorRole, geekBg, geekFg } from "../theme/geek-palette.js";
import { countLines, getTextOutput, stripTrailingNotice } from "./common.js";
import { renderBashResult } from "./bash.js";
import { renderFindResult } from "./find.js";
import { renderGrepResult } from "./grep.js";
import { renderLsResult } from "./ls.js";
import { renderReadResult } from "./read.js";
import { renderOutputBody } from "./tool-row.js";
import { isToolRunning, formatSeconds, toolElapsedMs } from "./tool-summary.js";

/**
 * Expanded / running group body (docs/design/geek-ui-spec.md §7):
 *   ├── $ test auth          lines      11  █████████████░░░  11/14
 *   └── T thinking           "3 remaining tests all call rotate() before sign…"
 * Call column 22 = 1-cell badge + space + 20-cell label; dim state label padded to 9; num value
 * right-aligned to 6; optional 16-cell progress bar.
 */

export type TreeEntry = { kind: "tool"; tool: any } | { kind: "thought"; text: string };

const CALL_COLUMN = 22;
const LABEL_WIDTH = 9;
const VALUE_WIDTH = 6;
const BAR_CELLS = 16;
const TREE_INDENT = 6;

const BADGES: Record<string, { letter: string; bg: GeekColorRole }> = {
	bash: { letter: "$", bg: "num" },
	edit: { letter: "E", bg: "kw" },
	thinking: { letter: "T", bg: "accent" },
};

function badge(toolName: string): string {
	const known = BADGES[toolName];
	const letter = known?.letter ?? (toolName[0] ?? "?").toUpperCase();
	return geekBg(known?.bg ?? "badgeBg", geekFg("badgeFg", letter));
}

function callLabel(tool: any): string {
	const args = tool.args ?? {};
	switch (tool.toolName) {
		case "bash":
			return String(args.command ?? "").split("\n")[0] ?? "";
		case "read":
		case "ls":
			return String(args.path ?? args.file_path ?? ".");
		case "grep":
		case "find":
			return String(args.pattern ?? "");
		default:
			return tool.toolName;
	}
}

type Stats = {
	label: string;
	labelRole: GeekColorRole;
	/** Pre-colored value, with its plain width for right alignment. */
	value?: { text: string; width: number };
	progress?: { done: number; total: number };
};

const RESULT_COUNT_LABEL: Record<string, string> = { read: "lines", bash: "lines", grep: "matches", find: "files", ls: "entries" };

function plainValue(text: string, role: GeekColorRole = "num"): { text: string; width: number } {
	return { text: geekFg(role, text), width: text.length };
}

/** `n/m` in the last non-empty output line drives the bar (test runners, builds). */
function parseProgress(text: string): { done: number; total: number } | undefined {
	const tail = text.slice(-400).trimEnd();
	const lastLine = tail.slice(tail.lastIndexOf("\n") + 1);
	const match = lastLine.match(/\b(\d+)\s*\/\s*(\d+)\b/);
	if (!match) return undefined;
	const done = Number(match[1]);
	const total = Number(match[2]);
	return total > 0 && done <= total ? { done, total } : undefined;
}

const statsCache = new WeakMap<object, { result: unknown; stats: Stats }>();

/** Result-derived part (counts, progress) is cached per result object; elapsed is read live. */
function resultStats(tool: any): Stats {
	const cached = statsCache.get(tool);
	if (cached && cached.result === tool.result) return cached.stats;
	const text = stripTrailingNotice(stripAnsi(getTextOutput(tool.result)));
	const countLabel = RESULT_COUNT_LABEL[tool.toolName];
	let stats: Stats;
	if (tool.result?.isError) {
		stats = { label: "failed", labelRole: "delMark" };
	} else if (countLabel) {
		const lines = typeof tool.result?.details?.truncation?.outputLines === "number" ? tool.result.details.truncation.outputLines : countLines(text);
		stats = { label: countLabel, labelRole: "dim", value: plainValue(geekNumber(lines)), progress: isToolRunning(tool) ? parseProgress(text) : undefined };
	} else {
		stats = { label: "done", labelRole: "dim" };
	}
	statsCache.set(tool, { result: tool.result, stats });
	return stats;
}

function toolStats(tool: any): Stats {
	if (isToolRunning(tool)) {
		const partial = tool.result ? resultStats(tool) : undefined;
		if (partial?.value) return { ...partial, labelRole: "accent" };
		const ms = toolElapsedMs(tool);
		return { label: "running", labelRole: "accent", value: ms === undefined ? undefined : plainValue(`${formatSeconds(ms)}s`) };
	}
	const stats = resultStats(tool);
	if (stats.value) return stats;
	const ms = toolElapsedMs(tool);
	return { ...stats, value: ms === undefined ? undefined : plainValue(`${formatSeconds(ms)}s`) };
}

function statsCells(stats: Stats): string {
	const label = geekFg(stats.labelRole, stats.label.padEnd(LABEL_WIDTH).slice(0, LABEL_WIDTH));
	const value = stats.value ? `${" ".repeat(Math.max(0, VALUE_WIDTH - stats.value.width))}${stats.value.text}` : "";
	if (!stats.progress) return `${label}${value}`;
	const { done, total } = stats.progress;
	const fill = Math.max(0, Math.min(BAR_CELLS, Math.round((done / total) * BAR_CELLS)));
	const bar = `${geekFg("accent", "█".repeat(fill))}${geekFg("faint", "░".repeat(BAR_CELLS - fill))}`;
	return `${label}${value}  ${bar}  ${geekFg("dim", `${done}/${total}`)}`;
}

function callColumn(name: string, label: string): string {
	const text = safeTruncateToWidth(label.replace(/\s+/g, " ").trim(), CALL_COLUMN - 2, "…");
	return `${badge(name)} ${text}${" ".repeat(Math.max(0, CALL_COLUMN - 2 - safeVisibleWidth(text)))}`;
}

const RESULT_BODIES: Record<string, (result: any, options: any, theme: any, context: any) => { render(width: number): string[] }> = {
	read: renderReadResult,
	bash: renderBashResult,
	grep: renderGrepResult,
	find: renderFindResult,
	ls: renderLsResult,
};

const bodyCache = new WeakMap<object, { result: unknown; body: { render(width: number): string[] } }>();

function expandedBody(entry: TreeEntry): { render(width: number): string[] } | undefined {
	if (entry.kind === "thought") return renderOutputBody({ content: [{ type: "text", text: entry.text }] }, { expanded: true });
	const { tool } = entry;
	if (!tool.result) return undefined;
	const cached = bodyCache.get(tool);
	if (cached && cached.result === tool.result) return cached.body;
	const render = RESULT_BODIES[tool.toolName];
	const body = render
		? render(tool.result, { expanded: true }, undefined, { args: tool.args })
		: renderOutputBody(tool.result, { expanded: true });
	bodyCache.set(tool, { result: tool.result, body });
	return body;
}

/** Tree rows (already prefixed with gutter + rail) for the group's members, in call order. */
export function renderToolTree(entries: TreeEntry[], width: number, rail: GeekRail, expanded: boolean): string[] {
	const rows: string[] = [];
	const bodyWidth = Math.max(1, width - 8 - TREE_INDENT);
	entries.forEach((entry, index) => {
		const last = index === entries.length - 1;
		const guide = geekFg("faint", `  ${last ? "└──" : "├──"} `);
		if (entry.kind === "thought") {
			const flat = entry.text.replace(/\s+/g, " ").trim();
			const room = Math.max(1, width - 8 - TREE_INDENT - CALL_COLUMN);
			const quote = geekFg("dim", safeVisibleWidth(`"${flat}"`) <= room ? `"${flat}"` : safeTruncateToWidth(`"${flat}`, room, "…"));
			rows.push(geekRow(rail, `${guide}${callColumn("thinking", "thinking")}${quote}`, width));
		} else {
			rows.push(geekRow(rail, `${guide}${callColumn(entry.tool.toolName, callLabel(entry.tool))}${statsCells(toolStats(entry.tool))}`, width));
		}
		if (!expanded) return;
		const body = expandedBody(entry);
		if (!body) return;
		const pipe = geekFg("faint", last ? " ".repeat(TREE_INDENT) : `  │${" ".repeat(TREE_INDENT - 3)}`);
		for (const line of body.render(bodyWidth)) rows.push(geekRow(rail, `${pipe}${line}`, width));
	});
	return rows;
}
