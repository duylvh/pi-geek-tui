import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import type { ExtensionAPI, ToolRenderResultOptions } from "@earendil-works/pi-coding-agent";
import { getAgentDir, getLanguageFromPath } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";

import { safeTruncateToWidth } from "../render-budget.js";
import { stripAnsi } from "../theme/ansi.js";
import { geekFg } from "../theme/geek-palette.js";
import {
	DiffRowsComponent,
	buildDiffRows,
	countDiffStats,
	extractEditedPath,
	firstText,
} from "../split-diff.js";
import { getTextOutput, isExpanded, resolveRelativePath } from "./common.js";
import { markToolCallExecutionStarted, resolveToolCallElapsedMs, wrapExecuteWithTiming } from "./elapsed.js";
import { inkParams, soloLine } from "./tool-call-line.js";
import { metaText, renderCallRow, renderOutputBody, setRowMeta } from "./tool-row.js";
import { secondsText } from "./tool-summary.js";

const MAX_HIGHLIGHT_DIFF_ROWS = 120;

type EditCoreModule = {
	EDIT_TOOL_DESCRIPTION: string;
	EditArgsSchema: unknown;
	executeEnhancedEdit: (...args: any[]) => any;
};

async function importEditCore(specifier: string): Promise<EditCoreModule | undefined> {
	try {
		return await import(specifier) as EditCoreModule;
	} catch {
		return undefined;
	}
}

async function loadEditCore(): Promise<EditCoreModule | undefined> {
	const packageImport = await importEditCore("pi-ctx-kit/edit-core");
	if (packageImport) return packageImport;

	const installedPaths = [
		join(getAgentDir(), "git", "github.com", "sting8k", "pi-ctx-kit", "edit-core.ts"),
		join(process.cwd(), ".pi", "git", "github.com", "sting8k", "pi-ctx-kit", "edit-core.ts"),
		join(process.cwd(), "..", "pi-ctx-kit", "edit-core.ts"),
	];

	for (const path of installedPaths) {
		if (!existsSync(path)) continue;
		const editCore = await importEditCore(pathToFileURL(path).href);
		if (editCore) return editCore;
	}

	return undefined;
}

/** Script-mode edit (pi-utils US-003): args.paths is the declared file list. */
function scriptModePaths(args: any): string[] | null {
	const paths = args?.paths;
	return Array.isArray(paths) ? paths.filter((p): p is string => typeof p === "string") : null;
}

/** Strip unified-patch file headers (---/+++/diff/index) — parseDiffLine would misread them as +/- lines. @@ hunks stay: they seed split-diff line numbers. */
function stripPatchHeaders(patch: string): string {
	return patch
		.split("\n")
		.filter((l) => !/^(diff |index |--- |\+\+\+ |new file|deleted file)/.test(l))
		.join("\n");
}

/**
 * Split a script-mode unified patch into per-file sections so multi-file
 * edits stay attributable. A file header is `--- ` + `+++ ` directly followed
 * by an @@ hunk; a patch without such headers stays one untitled section.
 */
function splitPatchFiles(patch: string): Array<{ path?: string; body: string }> {
	const lines = patch.split("\n");
	const files: Array<{ path?: string; lines: string[] }> = [];
	let current: { path?: string; lines: string[] } | undefined;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? "";
		const next = lines[i + 1] ?? "";
		if (line.startsWith("--- ") && next.startsWith("+++ ") && (lines[i + 2] ?? "").startsWith("@@")) {
			current = { path: next.slice(4).replace(/^b\//, ""), lines: [] };
			files.push(current);
			i++;
			continue;
		}
		if (!current) {
			current = { lines: [] };
			files.push(current);
		}
		current.lines.push(line);
	}
	return files.map((file) => ({
		path: file.path,
		body: file.path ? file.lines.join("\n") : stripPatchHeaders(file.lines.join("\n")),
	}));
}

function countRowStats(rows: Array<{ left?: unknown; right?: unknown; kind: string }>): { additions: number; removals: number } {
	let additions = 0;
	let removals = 0;
	for (const row of rows) {
		if (row.kind === "context") continue;
		if (row.right) additions += 1;
		if (row.left) removals += 1;
	}
	return { additions, removals };
}

/** `+2 -2 · 0.1s` meta shared by every edit-class result. */
export function publishEditMeta(context: any, result: any, additions: number, removals: number): void {
	const elapsed = resolveToolCallElapsedMs(context, result);
	const parts = [`${geekFg("mono", `+${additions}`)} ${geekFg("delMark", `-${removals}`)}`];
	if (elapsed !== undefined) parts.push(secondsText(elapsed));
	setRowMeta(context?.state, metaText(parts));
}

export function publishFailedMeta(context: any, result: any): void {
	const elapsed = resolveToolCallElapsedMs(context, result);
	setRowMeta(context?.state, metaText([geekFg("delMark", "failed"), ...(elapsed !== undefined ? [secondsText(elapsed)] : [])]));
}

/** One titled diff per file; `maxRows` is split between files so a big patch cannot hide the rest. */
export function diffSectionsBody(sections: Array<{ title?: string; rows: ReturnType<typeof buildDiffRows>; language?: string }>, maxRows: number): Component {
	const parts = sections.map((section) => {
		const highlight = Boolean(section.language) && section.rows.length <= MAX_HIGHLIGHT_DIFF_ROWS;
		const partRows = section.title ? Math.max(6, Math.floor(maxRows / sections.length)) : maxRows;
		return { title: section.title, diff: new DiffRowsComponent(section.rows, partRows, highlight ? section.language : undefined) };
	});
	return {
		render(width: number): string[] {
			return parts.flatMap(({ title, diff }) => [
				...(title ? [geekFg("dim", safeTruncateToWidth(title, width, "…"))] : []),
				...diff.render(width),
			]);
		},
		invalidate(): void {
			for (const { diff } of parts) diff.invalidate();
		},
	};
}

export function renderEditCall(args: any, _theme: any, context: any) {
	markToolCallExecutionStarted(context);
	const cwd = typeof context?.cwd === "string" ? context.cwd : process.cwd();
	const paths = scriptModePaths(args);
	let detail: string;
	if (paths && paths.length > 0) {
		const shown = paths.length > 2 ? `${paths.length} paths` : paths.map((p) => resolveRelativePath(p, cwd) || p).join(", ");
		const lang = typeof args?.lang === "string" && args.lang ? ` (${args.lang})` : "";
		detail = shown + lang;
	} else {
		const rawPath = String(args?.path ?? args?.file_path ?? "");
		detail = (rawPath ? resolveRelativePath(rawPath, cwd) : "");
	}
	return renderCallRow(soloLine("edit", inkParams(detail), Boolean(context?.isError)), context);
}

export function renderEditResult(result: any, options: ToolRenderResultOptions, _theme: any, context: any) {
	if (options.isPartial) return renderOutputBody({ content: [] }, { expanded: true });

	if (result.isError) {
		publishFailedMeta(context, result);
		return renderOutputBody(result, { expanded: true });
	}

	// Script-mode edit carries a unified patch; default edit keeps its native `diff` format untouched.
	const scriptMode = scriptModePaths(context?.args) !== null;
	const details = result.details as { diff?: string; patch?: string; path?: string } | undefined;
	const rawDiff = scriptMode ? (details?.patch ?? details?.diff) : details?.diff;
	const sections = rawDiff ? (scriptMode ? splitPatchFiles(rawDiff) : [{ body: rawDiff }]) : [];
	const diff = sections.map((section) => section.body).join("\n");

	if (!diff) {
		publishEditMeta(context, result, 0, 0);
		const output = stripAnsi(getTextOutput(result)).trim();
		return renderOutputBody({ content: [{ type: "text", text: output }] }, { expanded: true });
	}

	const message = firstText(result.content);
	const argPath = String(context?.args?.path ?? context?.args?.file_path ?? (scriptMode ? (context?.args?.paths?.[0] ?? "") : ""));
	const sourcePath = details?.path ?? (argPath || extractEditedPath(message));
	const language = sourcePath ? getLanguageFromPath(sourcePath) : undefined;
	const titled = sections.length > 1;
	const cwd = typeof context?.cwd === "string" ? context.cwd : process.cwd();
	const parts = sections.map((section) => ({
		title: titled && section.path ? `▸ ${resolveRelativePath(section.path, cwd) || section.path}` : undefined,
		rows: buildDiffRows(section.body),
		language: section.path ? getLanguageFromPath(section.path) : language,
	}));

	// Script-mode bodies carry no file headers, so count parsed rows: a content line like "+---" must count.
	const { additions, removals } = scriptMode ? countRowStats(parts.flatMap((part) => part.rows)) : countDiffStats(diff);
	publishEditMeta(context, result, additions, removals);
	return diffSectionsBody(parts, isExpanded(options) ? 160 : 36);
}

/**
 * Registers `edit` only when pi-ctx-kit supplies the enhanced edit core. Without
 * it the builtin tool stays registered (keeping its builtin source) and gets the
 * droid renderers from installBuiltinToolRenderers.
 */
export async function registerEditTool(pi: ExtensionAPI): Promise<void> {
	const editCore = await loadEditCore();
	if (!editCore) return;

	pi.registerTool({
		name: "edit",
		label: "edit",
		description: editCore.EDIT_TOOL_DESCRIPTION,
		parameters: editCore.EditArgsSchema as any,
		execute: wrapExecuteWithTiming(async (toolCallId, params, signal, onUpdate, ctx) =>
			editCore.executeEnhancedEdit(toolCallId, params, signal, onUpdate, ctx)),
		renderCall: renderEditCall,
		renderResult: renderEditResult,
	});
}
