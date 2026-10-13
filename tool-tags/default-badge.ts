import { ToolExecutionComponent } from "@earendil-works/pi-coding-agent";

import { annotateToolResultElapsed } from "./elapsed.js";
import { isEditClassTool } from "./tool-summary.js";

const PATCH_FLAG = "__defaultBadgePatched__";
const RENDERED_FLAG = Symbol("__defaultBadge_rendered__");
const EXECUTION_STARTED_AT_FLAG = Symbol("__defaultBadge_executionStartedAt__");

function tightenContainer(thisArg: any): void {
	const renderShell = typeof thisArg.getRenderShell === "function" ? thisArg.getRenderShell() : "default";
	const container = renderShell === "self" ? thisArg.selfRenderContainer : thisArg.contentBox;
	if (!container) return;
	container.paddingX = 0;
	container.paddingY = 0;
	if (typeof container.setBgFn === "function") container.setBgFn((text: string) => text);
	if (typeof container.invalidateCache === "function") container.invalidateCache();
}

export function installDefaultBadge(): void {
	const globalState = globalThis as Record<string, unknown>;
	if (globalState[PATCH_FLAG]) return;
	globalState[PATCH_FLAG] = true;

	const proto = ToolExecutionComponent.prototype as any;
	if (!proto || typeof proto.updateDisplay !== "function") return;

	const baseMarkExecutionStarted = proto.markExecutionStarted;
	if (typeof baseMarkExecutionStarted === "function") {
		proto.markExecutionStarted = function patchedDefaultBadgeMarkExecutionStarted(this: any, ...args: any[]) {
			this[EXECUTION_STARTED_AT_FLAG] = performance.now();
			return baseMarkExecutionStarted.apply(this, args);
		};
	}

	const baseUpdateResult = proto.updateResult;
	if (typeof baseUpdateResult === "function") {
		proto.updateResult = function patchedDefaultBadgeUpdateResult(this: any, result: any, isPartial: boolean = false, ...rest: any[]) {
			if (!isPartial && result && typeof result === "object") {
				const startedAt = typeof this[EXECUTION_STARTED_AT_FLAG] === "number" ? this[EXECUTION_STARTED_AT_FLAG] : undefined;
				const elapsedMs = startedAt === undefined ? undefined : Math.max(0, performance.now() - startedAt);
				annotateToolResultElapsed(result, elapsedMs);
			}
			return baseUpdateResult.call(this, result, isPartial, ...rest);
		};
	}

	const baseUpdateDisplay = proto.updateDisplay;
	proto.updateDisplay = function patchedDefaultBadge(this: any, ...args: any[]) {
		// Force invalidate cached renderer on first render to fix resume render issue
		// (only for completed tools that haven't been rendered yet)
		if (!this[RENDERED_FLAG] && this.resultRendererComponent && typeof this.resultRendererComponent.invalidate === "function") {
			try {
				this.resultRendererComponent.invalidate();
			} catch {
				// best effort
			}
		}
		this[RENDERED_FLAG] = true;

		const result = baseUpdateDisplay.apply(this, args);

		// Edit-class tools stay standalone rows inside a plain Box; drop its padding and status background.
		if (isEditClassTool(this.toolName)) tightenContainer(this);
		return result;
	};
}
