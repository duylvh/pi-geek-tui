/**
 * Throttle TUI rendering to a target frame rate.
 *
 * Pi's default `requestRender` fires on every `process.nextTick`, which can
 * cause excessive renders during fast streaming. This patches the TUI instance
 * to batch renders into fixed intervals (default 29ms ≈ 35fps).
 *
 * Typing input triggers an immediate render (no delay) for responsiveness.
 */

import { profileCount, profileDuration, profileNow, profileSample } from "./profiler.js";
import { getOriginalTuiMethod, rememberTuiMethodWrapper } from "./tui-proxy-original.js";

const PATCHED = Symbol.for("pi-geek-tui.render-throttle.patched");

/** Default frame interval in ms (29ms ~ 35fps) */
const DEFAULT_FRAME_MS = 29;

function normalizeFrameMs(value: number, fallback: number): number {
	if (!Number.isFinite(value) || value < 0) return fallback;
	return Math.floor(value);
}

export function installRenderThrottle(tui: any, frameMs: number = DEFAULT_FRAME_MS): void {
	if (tui[PATCHED]) return;
	tui[PATCHED] = true;

	const origRequestRender = getOriginalTuiMethod(tui, "requestRender");
	const defaultFrameMs = normalizeFrameMs(frameMs, DEFAULT_FRAME_MS);

	let timer: ReturnType<typeof setTimeout> | null = null;
	let timerDueAt = 0;
	let lastRenderTime = 0;
	let pendingForce = false;
	let currentTui: any = tui;

	function clearScheduledRender(): void {
		if (timer === null) return;
		clearTimeout(timer);
		timer = null;
		timerDueAt = 0;
	}

	function dispatchRender(now: number): void {
		clearScheduledRender();
		lastRenderTime = now;
		origRequestRender.call(currentTui, pendingForce);
		pendingForce = false;
	}

	function scheduleRender(delay: number): void {
		const scheduledAt = profileNow();
		timerDueAt = Date.now() + delay;
		timer = setTimeout(() => {
			timer = null;
			timerDueAt = 0;
			lastRenderTime = Date.now();
			profileCount("render.request.dispatch.delayed");
			profileDuration("render.request.latency.ms", scheduledAt);
			origRequestRender.call(currentTui, pendingForce);
			pendingForce = false;
		}, delay);
	}

	function requestRenderAtFrame(force = false): void {
		profileCount("render.request.calls");
		if (force) {
			pendingForce = true;
			profileCount("render.request.force");
		}

		const now = Date.now();
		const elapsed = now - lastRenderTime;

		if (elapsed >= defaultFrameMs) {
			// Enough time passed — render immediately
			profileCount("render.request.dispatch.immediate");
			profileSample("render.request.latency.ms", 0);
			dispatchRender(now);
			return;
		}

		const delay = defaultFrameMs - elapsed;
		const dueAt = now + delay;
		if (timer !== null) {
			if (dueAt < timerDueAt) {
				profileCount("render.request.rescheduledEarlier");
				profileSample("render.request.delay.ms", delay);
				clearScheduledRender();
				scheduleRender(delay);
			} else {
				profileCount("render.request.coalesced");
			}
			return;
		}

		// Schedule render for remaining time
		profileCount("render.request.scheduled");
		profileSample("render.request.delay.ms", delay);
		scheduleRender(delay);
	}

	const throttledRequestRender = function throttledRequestRender(this: any, force = false) {
		if (this != null) currentTui = this;
		requestRenderAtFrame(force);
	};
	tui.requestRender = throttledRequestRender;
	rememberTuiMethodWrapper(tui, "requestRender", throttledRequestRender);
}
