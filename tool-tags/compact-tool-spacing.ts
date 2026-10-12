import { ToolExecutionComponent } from "@earendil-works/pi-coding-agent";

import { GEEK_PREFIX_WIDTH, geekRow } from "../presentation/geek-rows.js";
import { isImageRenderLine } from "../render-budget.js";
import { stripAnsi } from "../theme/ansi.js";
import { toolRail } from "./tool-summary.js";

const PATCHED = Symbol.for("pi-geek-tui.tool-spacing.patched");
const RUNTIME = Symbol.for("pi-geek-tui.tool-spacing.runtime");

type RenderFn = (this: any, width: number) => string[];

function isBlank(line: string | undefined): boolean {
	return stripAnsi(line ?? "").trim() === "";
}

function trimOuterBlankLines(lines: string[]): string[] {
	let start = 0;
	let end = lines.length;
	while (start < end && isBlank(lines[start])) start++;
	while (end > start && isBlank(lines[end - 1])) end--;
	return lines.slice(start, end);
}

/**
 * ToolExecutionComponent appends terminal image lines (kitty/iTerm2 escape payloads) after the
 * text content. stripAnsi() reduces them to empty strings, so blank trimming would drop them.
 * Split them off (with their leading spacer) first and re-append untouched.
 */
function splitImageTail(lines: string[]): { content: string[]; tail: string[] } {
	const first = lines.findIndex(isImageRenderLine);
	if (first < 0) return { content: lines, tail: [] };
	let start = first;
	while (start > 0 && isBlank(lines[start - 1])) start--;
	return { content: lines.slice(0, start), tail: lines.slice(start) };
}

/**
 * A standalone tool block as chat rows: renderers draw into `width - prefix` body cells, then
 * every row gets the gutter + rail (`┃` accent while the call runs) and one blank rail row follows.
 */
function renderToolRows(tool: any, baseRender: RenderFn, width: number): string[] {
	if (width <= GEEK_PREFIX_WIDTH) return baseRender.call(tool, width);
	const rendered = baseRender.call(tool, width - GEEK_PREFIX_WIDTH);
	if (rendered.length === 0) return rendered;
	const { content, tail } = splitImageTail(rendered);
	const rail = toolRail([tool]);
	const rows = trimOuterBlankLines(content).map((line) => geekRow(rail, line, width));
	return [...rows, ...tail, geekRow("line", "", width)];
}

/**
 * Wraps ToolExecutionComponent.render once per host prototype. The wrapper only forwards to the
 * RUNTIME hook, which every install refreshes, so a reload swaps behavior without stacking wrappers.
 */
export function installCompactToolSpacing(ToolExecutionComponentClass: any = ToolExecutionComponent): void {
	const proto = ToolExecutionComponentClass?.prototype as any;
	if (!proto || typeof proto.render !== "function") return;

	proto[RUNTIME] = renderToolRows;
	if (proto[PATCHED]) return;
	proto[PATCHED] = true;

	const baseRender: RenderFn = proto.render;
	proto.render = function patchedToolRender(this: any, width: number): string[] {
		return (proto[RUNTIME] as typeof renderToolRows)(this, baseRender, width);
	};
}
