import type { ToolRenderResultOptions } from "@earendil-works/pi-coding-agent";
import { getLanguageFromPath } from "@earendil-works/pi-coding-agent";

import { stripAnsi } from "../theme/ansi.js";
import { buildDiffRows, countDiffStats } from "../split-diff.js";
import { getTextOutput, isExpanded, resolveRelativePath } from "./common.js";
import { diffSectionsBody, publishEditMeta, publishFailedMeta } from "./edit.js";
import { markToolCallExecutionStarted } from "./elapsed.js";
import { EMPTY_BODY, renderCallRow, renderOutputBody } from "./tool-row.js";

const RESULT_PATCHED = Symbol.for("pi-geek-tui.quick-edit-renderer.result.patched");
const CALL_PATCHED = Symbol.for("pi-geek-tui.quick-edit-renderer.call.patched");

type QuickEditToolConfig = {
	name: string;
	fallbackLabel: string;
};

const QUICK_EDIT_TOOLS: Record<string, QuickEditToolConfig> = {
	quick_edit: { name: "quick_edit", fallbackLabel: "Quick edit applied" },
	substitute_edit: { name: "substitute_edit", fallbackLabel: "Substitute edit applied" },
	target_edit: { name: "target_edit", fallbackLabel: "Target edit applied" },
};

function getQuickEditToolConfig(toolName: unknown): QuickEditToolConfig | undefined {
	return typeof toolName === "string" ? QUICK_EDIT_TOOLS[toolName] : undefined;
}

type QuickEditRenderContext = {
	args?: any;
	isError?: boolean;
	isPartial?: boolean;
	hasResult?: boolean;
	state?: Record<string, any>;
	executionStarted?: boolean;
	cwd?: string;
};

function extractQuickEditDiff(text: string): string | undefined {
	const lines = stripAnsi(text).replace(/\r/g, "").split("\n");
	const start = lines.indexOf("── diff ──");
	if (start < 0) return undefined;

	const diffLines: string[] = [];
	let cumulativeDelta = 0;
	let oldLine: number | undefined;
	let newLine: number | undefined;
	let chunkAdditions = 0;
	let chunkRemovals = 0;

	const finishChunk = () => {
		cumulativeDelta += chunkAdditions - chunkRemovals;
		oldLine = undefined;
		newLine = undefined;
		chunkAdditions = 0;
		chunkRemovals = 0;
	};

	for (const line of lines.slice(start + 1)) {
		if (line === "") {
			finishChunk();
			continue;
		}

		const headerMatch = line.match(/^:(\d+)(?:-\d+)?$/);
		if (headerMatch) {
			finishChunk();
			const startLine = Number.parseInt(headerMatch[1] ?? "", 10);
			oldLine = startLine;
			newLine = startLine + cumulativeDelta;
			continue;
		}

		const match = line.match(/^([+-]) (.*)$/);
		if (match) {
			const [, sign, content = ""] = match;
			let gutter = "";
			if (sign === "-" && oldLine !== undefined) gutter = String(oldLine++);
			if (sign === "+" && newLine !== undefined) gutter = String(newLine++);
			if (!gutter) continue;
			if (sign === "-") chunkRemovals++;
			if (sign === "+") chunkAdditions++;
			diffLines.push(`${sign} ${gutter} ${content}`);
			continue;
		}

		if (line === "---") break;
	}

	return diffLines.length > 0 ? diffLines.join("\n") : undefined;
}

function renderQuickEditCall(args: any, config: QuickEditToolConfig, context: QuickEditRenderContext = {}) {
	markToolCallExecutionStarted(context);
	const rawPath = String(args?.path ?? "");
	const cwd = typeof context.cwd === "string" ? context.cwd : process.cwd();
	return renderCallRow(`${config.name} ${(rawPath ? resolveRelativePath(rawPath, cwd) : "") || "(unknown)"}`, context);
}

function renderQuickEditResult(result: any, options: ToolRenderResultOptions, config: QuickEditToolConfig, context: QuickEditRenderContext = {}) {
	if (options.isPartial) return EMPTY_BODY;
	if (context.isError || result?.isError) {
		publishFailedMeta(context, result);
		return renderOutputBody(result, { expanded: true });
	}

	const output = getTextOutput(result);
	const diff = extractQuickEditDiff(output);
	if (!diff) {
		publishEditMeta(context, result, 0, 0);
		return renderOutputBody({ content: [{ type: "text", text: stripAnsi(output).trim() || config.fallbackLabel }] }, { expanded: true });
	}

	const argPath = String(context?.args?.path ?? "");
	const { additions, removals } = countDiffStats(diff);
	publishEditMeta(context, result, additions, removals);
	return diffSectionsBody([{ rows: buildDiffRows(diff), language: argPath ? getLanguageFromPath(argPath) : undefined }], isExpanded(options) ? 160 : 36);
}

export function installQuickEditRenderer(ToolExecutionComponentClass: any): void {
	const proto = ToolExecutionComponentClass?.prototype;
	if (!proto) return;

	if (!proto[RESULT_PATCHED] && typeof proto.getResultRenderer === "function") {
		proto[RESULT_PATCHED] = true;
		const baseGetResultRenderer = proto.getResultRenderer;
		proto.getResultRenderer = function patchedQuickEditResultRenderer(this: any, ...args: any[]) {
			const config = getQuickEditToolConfig(this.toolName);
			if (config) return (result: any, options: ToolRenderResultOptions, theme: any, context: QuickEditRenderContext = {}) =>
				renderQuickEditResult(result, options, config, context);
			return baseGetResultRenderer.apply(this, args);
		};
	}

	if (!proto[CALL_PATCHED] && typeof proto.getCallRenderer === "function") {
		proto[CALL_PATCHED] = true;
		const baseGetCallRenderer = proto.getCallRenderer;
		proto.getCallRenderer = function patchedQuickEditCallRenderer(this: any, ...args: any[]) {
			const config = getQuickEditToolConfig(this.toolName);
			if (config) return (args: any, theme: any, context: QuickEditRenderContext = {}) => renderQuickEditCall(args, config, context);
			return baseGetCallRenderer.apply(this, args);
		};
	}
}
