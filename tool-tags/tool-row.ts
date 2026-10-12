import type { Component } from "@earendil-works/pi-tui";

import { loadConfig } from "../config.js";
import { geekSplitRow } from "../presentation/geek-rows.js";
import { clampRenderLine, safeTruncateToWidth } from "../render-budget.js";
import { stripAnsi } from "../theme/ansi.js";
import { geekFg } from "../theme/geek-palette.js";
import { getTextOutput, replaceTabs, stripTrailingNotice } from "./common.js";
import { resolveToolCallElapsedMs, runningElapsedMs } from "./elapsed.js";
import { secondsText } from "./tool-summary.js";

/**
 * Standalone tool rows (docs/design/geek-ui-spec.md §6): `E Edit(Path: …)` on the left and a dim
 * `// meta` on the right. Widths here are body widths: the render patch in compact-tool-spacing
 * adds the gutter + rail and hands renderers `width - prefix`.
 */

const META_KEY = "__geekRowMeta";

type RowContext = { state?: Record<string, any>; toolCallId?: string; isPartial?: boolean };

/** `// a · b · c` in dim, parts already styled. */
export function metaText(parts: string[]): string {
	const dim = (text: string) => geekFg("dim", text);
	return `${dim("// ")}${parts.join(dim(" · "))}`;
}

/** Result renderers publish the right-hand meta here; the call row reads it at render time. */
export function setRowMeta(state: Record<string, any> | undefined, meta: string): void {
	if (state && typeof state === "object") state[META_KEY] = meta;
}

function defaultMeta(context: RowContext | undefined): string {
	const running = Boolean(context?.isPartial);
	const state = context?.state;
	const elapsed = running ? runningElapsedMs(state) : resolveToolCallElapsedMs(context, undefined);
	const parts: string[] = [];
	if (running) parts.push(geekFg("accent", "running"));
	if (elapsed !== undefined) parts.push(secondsText(elapsed));
	return parts.length > 0 ? metaText(parts) : "";
}

/** One row: call line … `// <meta>`. `left` is the already-styled call line (badge + Name(params)). */
export function renderCallRow(left: string, context: RowContext | undefined): Component {
	return {
		invalidate() {},
		render(width: number): string[] {
			const meta = context?.state?.[META_KEY];
			const running = Boolean(context?.isPartial);
			return [geekSplitRow(left, typeof meta === "string" && !running ? meta : defaultMeta(context), width)];
		},
	};
}

/** Result renderer that draws nothing (the call row already carries the status). */
export const EMPTY_BODY: Component = { invalidate() {}, render: () => [] };

type Cached = { key: string; lines: string[] };

/** A body component that renders only while the tool is expanded, cached per width. */
export function renderBody(expanded: boolean, build: (width: number, maxLines: number) => string[]): Component {
	let cache: Cached | undefined;
	return {
		invalidate() { cache = undefined; },
		render(width: number): string[] {
			if (!expanded) return [];
			const maxLines = loadConfig().maxExpandedLines;
			const key = `${width}|${maxLines}`;
			if (cache?.key !== key) cache = { key, lines: build(width, maxLines) };
			return cache.lines;
		},
	};
}

function countNewlines(text: string, from: number, to: number): number {
	let count = 0;
	for (let i = from; i < to; i++) if (text.charCodeAt(i) === 10) count++;
	return count;
}

/** Head or tail `cap` lines without splitting the whole text (outputs can be megabytes). */
function pickLines(text: string, cap: number, tail: boolean): { lines: string[]; omitted: number } {
	if (cap <= 0) return { lines: text.split("\n"), omitted: 0 };
	if (tail) {
		let pos = text.length;
		for (let seen = 0; seen < cap; seen++) {
			if (pos <= 0) return { lines: text.split("\n"), omitted: 0 };
			const prev = text.lastIndexOf("\n", pos - 1);
			if (prev < 0) return { lines: text.split("\n"), omitted: 0 };
			pos = prev;
		}
		return { lines: text.slice(pos + 1).split("\n"), omitted: countNewlines(text, 0, pos) + 1 };
	}
	let end = 0;
	for (let seen = 0; seen < cap; seen++) {
		const next = text.indexOf("\n", end);
		if (next < 0) return { lines: text.split("\n"), omitted: 0 };
		end = next + 1;
	}
	const rest = text.slice(end);
	return { lines: text.slice(0, end - 1).split("\n"), omitted: rest ? countNewlines(rest, 0, rest.length) + 1 : 0 };
}

/**
 * Plain tool output as the expanded body: dim, capped at `maxExpandedLines`, errors in the del color.
 * Every expanded body (bash, generic tools, thoughts, read) is dim so output never competes with answers.
 * `tail` keeps the end of the output (bash); otherwise the start.
 */
export function renderOutputBody(result: any, options: { expanded?: boolean }, extra: { tail?: boolean; transform?: (text: string) => string } = {}): Component {
	const isError = Boolean(result?.isError);
	const raw = stripAnsi(getTextOutput(result)).replace(/\r/g, "");
	const text = replaceTabs((extra.transform ?? stripTrailingNotice)(raw)).trimEnd();
	return renderBody(Boolean(options?.expanded) && text.length > 0, (width, maxLines) => {
		const { lines, omitted } = pickLines(text, maxLines, Boolean(extra.tail));
		const color = isError ? "delMark" : "dim";
		const rows = lines.map((line) => geekFg(color, safeTruncateToWidth(clampRenderLine(line), width, "…")));
		if (omitted <= 0) return rows;
		const note = geekFg("faint", extra.tail ? `… ${omitted} earlier lines` : `… ${omitted} more lines`);
		return extra.tail ? [note, ...rows] : [...rows, note];
	});
}
