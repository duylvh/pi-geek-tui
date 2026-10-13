import type { AgentToolResult } from "@earendil-works/pi-coding-agent";

const ELAPSED_KEY = "__elapsedMs";

function getElapsedMs(result: AgentToolResult<any> | undefined): number | undefined {
	const elapsed = (result?.details as any)?.[ELAPSED_KEY];
	return typeof elapsed === "number" && Number.isFinite(elapsed) ? elapsed : undefined;
}

/** Stamp the measured wall time into result.details (persisted, so resumed history keeps its seconds). */
export function annotateToolResultElapsed(result: AgentToolResult<any> | undefined, elapsedMs?: number): void {
	if (!result || typeof result !== "object") return;
	if (!result.details || typeof result.details !== "object") {
		(result as any).details = {};
	}
	const details = result.details as any;
	const existingElapsed = details[ELAPSED_KEY];
	if (typeof elapsedMs === "number" && Number.isFinite(elapsedMs) && (typeof existingElapsed !== "number" || !Number.isFinite(existingElapsed))) {
		details[ELAPSED_KEY] = elapsedMs;
	}
}

/**
 * Component-state timing for decorated renderers.
 *
 * Renderers attached via ToolExecutionComponent patches have no execute wrapper,
 * so wall time comes from three sources, in order:
 * 1. frozen state value (first result render freezes it for the component lifetime),
 * 2. tool_execution_start/end events recorded by index.ts (current session run),
 * 3. result.details.__elapsedMs (providers that annotate results themselves).
 */
const STATE_STARTED_AT_KEY = "__geekStartedAt";
const STATE_ELAPSED_KEY = "__geekElapsedMs";

const toolCallStartAt = new Map<string, number>();
const toolCallElapsedById = new Map<string, number>();
const TIMING_CACHE_LIMIT = 512;

function evictOldest(map: Map<string, number>): void {
	while (map.size > TIMING_CACHE_LIMIT) {
		const oldest = map.keys().next().value;
		if (oldest === undefined) break;
		map.delete(oldest);
	}
}

export function recordToolCallTimingStart(toolCallId: string | undefined): void {
	if (!toolCallId) return;
	toolCallStartAt.set(toolCallId, performance.now());
	evictOldest(toolCallStartAt);
}

export function recordToolCallTimingEnd(toolCallId: string | undefined): void {
	if (!toolCallId) return;
	const start = toolCallStartAt.get(toolCallId);
	if (start === undefined) return;
	const elapsed = performance.now() - start;
	toolCallStartAt.delete(toolCallId);
	toolCallElapsedById.set(toolCallId, elapsed);
	evictOldest(toolCallElapsedById);
}

/**
 * Stamp the start time into renderer state once execution has begun, so elapsed
 * can be derived even without event records (e.g. components created mid-run).
 */
export function markToolCallExecutionStarted(context: { executionStarted?: boolean; state?: Record<string, unknown> } | undefined): void {
	const state = context?.state;
	if (!context?.executionStarted || !state || typeof state !== "object") return;
	if (typeof state[STATE_STARTED_AT_KEY] === "number") return;
	state[STATE_STARTED_AT_KEY] = performance.now();
}

export function resolveToolCallElapsedMs(
	context: { state?: Record<string, unknown>; toolCallId?: string } | undefined,
	result: AgentToolResult<any> | undefined,
): number | undefined {
	const state = context?.state;
	if (state && typeof state === "object") {
		const frozen = state[STATE_ELAPSED_KEY];
		if (typeof frozen === "number" && Number.isFinite(frozen)) return frozen;
	}
	const byId = typeof context?.toolCallId === "string" ? toolCallElapsedById.get(context.toolCallId) : undefined;
	const resolved = byId ?? getElapsedMs(result);
	if (Number.isFinite(resolved) && state && typeof state === "object") {
		state[STATE_ELAPSED_KEY] = resolved;
	}
	return typeof resolved === "number" && Number.isFinite(resolved) ? resolved : undefined;
}

/** Live elapsed of a tool that has started but not finished, from the start stamp in renderer state. */
export function runningElapsedMs(state: Record<string, unknown> | undefined, now = performance.now()): number | undefined {
	const startedAt = state?.[STATE_STARTED_AT_KEY];
	return typeof startedAt === "number" ? Math.max(0, now - startedAt) : undefined;
}
