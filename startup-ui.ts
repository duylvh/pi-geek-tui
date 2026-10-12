import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { safeTruncateToWidth, safeVisibleWidth } from "./render-budget.js";
import { geekFg } from "./theme/geek-palette.js";

const PATCHED = Symbol.for("pi-geek-tui.startup-ui.patched");
const ORIGINAL_SHOW_LOADED_RESOURCES = Symbol.for("pi-geek-tui.startup-ui.original-show-loaded-resources");
const CONSOLE_LOG_PATCHED = Symbol.for("pi-geek-tui.startup-ui.console-log-patched");

export interface StartupHeaderInfo {
	cwd: string;
	/** Read on every render; undefined hides the field. */
	getSessionName(): string | undefined;
	getTurnCount(): number;
}

function readJson(path: string): Record<string, unknown> {
	if (!existsSync(path)) return {};
	try {
		const parsed = JSON.parse(readFileSync(path, "utf-8"));
		return typeof parsed === "object" && parsed !== null ? parsed : {};
	} catch {
		return {};
	}
}

function isQuietStartup(cwd: string): boolean {
	const globalSettings = readJson(join(homedir(), ".pi", "agent", "settings.json"));
	const projectSettings = readJson(join(cwd, ".pi", "settings.json"));
	return Boolean((projectSettings.quietStartup ?? globalSettings.quietStartup) ?? false);
}

function displayCwd(cwd: string): string {
	const home = homedir().replace(/\\/g, "/");
	const normalized = cwd.replace(/\\/g, "/");
	return normalized === home || normalized.startsWith(`${home}/`) ? `~${normalized.slice(home.length)}` : normalized;
}

const RULE = "─";
const MIN_CWD_WIDTH = 6;

function rule(count: number): string {
	return geekFg("rail", RULE.repeat(Math.max(0, count)));
}

/** Keeps the tail of the path: `…ode/kpi-api`. */
function truncateCwdLeft(cwd: string, max: number): string {
	const chars = [...cwd];
	return chars.length <= max ? cwd : `…${chars.slice(chars.length - (max - 1)).join("")}`;
}

/**
 * Spec §1: one title-bar line on the rule: `── π pi ───── ~/code/kpi-api ─── refresh-ttl · turn 2 ──`.
 * Narrow widths drop, in order: cwd (left-truncated first), `turn N`, session name. `π pi` always stays.
 */
export function renderStartupHeader(info: StartupHeaderInfo, width: number): string[] {
	const name = info.getSessionName();
	const turns = info.getTurnCount();
	const total = Math.max(1, Math.floor(width));
	const cwd = displayCwd(info.cwd);

	const title = `${geekFg("accent", "π")} ${geekFg("ink", "pi")}`;
	const titleWidth = 4;
	const right = (withName: boolean, withTurn: boolean): { text: string; width: number } => {
		const parts: string[] = [];
		const plain: string[] = [];
		if (withName && name) {
			parts.push(geekFg("ink", name));
			plain.push(name);
		}
		if (withTurn && turns > 0) {
			const turn = `turn ${turns}`;
			parts.push(geekFg("dim", turn));
			plain.push(turn);
		}
		return { text: parts.join(geekFg("dim", " · ")), width: safeVisibleWidth(plain.join(" · ")) };
	};

	// Richest layout first; the first one that leaves at least one flexible rule cell wins.
	const attempts: Array<{ cwdMax: number; withName: boolean; withTurn: boolean }> = [
		{ cwdMax: Number.POSITIVE_INFINITY, withName: true, withTurn: true },
		...Array.from({ length: Math.max(0, [...cwd].length - MIN_CWD_WIDTH) }, (_, k) => ({ cwdMax: [...cwd].length - 1 - k, withName: true, withTurn: true })),
		{ cwdMax: 0, withName: true, withTurn: true },
		{ cwdMax: 0, withName: true, withTurn: false },
		{ cwdMax: 0, withName: false, withTurn: false },
	];
	for (const attempt of attempts) {
		const tail = right(attempt.withName, attempt.withTurn);
		const place = attempt.cwdMax > 0 ? truncateCwdLeft(cwd, attempt.cwdMax) : "";
		// 2 rule + sp + title + sp | flex>=1 | [sp + cwd + sp + 3 rule] + [sp + tail + sp] + 2 rule
		const fixed = 2 + 1 + titleWidth + 1 + (place ? 1 + safeVisibleWidth(place) + 1 + 3 : 0) + (tail.width ? 1 + tail.width + 1 : 0) + 2;
		const flex = total - fixed;
		if (flex < 1 && attempt.withName) continue;
		if (flex < 0) break;
		const middle = place ? ` ${geekFg("dim", place)} ${rule(3)}` : "";
		const end = tail.width ? ` ${tail.text} ` : "";
		return [`${rule(2)} ${title} ${rule(flex)}${middle}${end}${rule(2)}`];
	}
	return [safeTruncateToWidth(`${rule(2)} ${title} ${rule(total)}`, total, "")];
}

export function setStartupHeader(ui: ExtensionUIContext, info: StartupHeaderInfo): void {
	if (isQuietStartup(info.cwd)) return;
	ui.setHeader(() => ({
		invalidate() {},
		render: (width: number) => renderStartupHeader(info, width),
	}));
}

export function suppressStartupModelScopeLog(): void {
	const consoleState = console as typeof console & { [CONSOLE_LOG_PATCHED]?: boolean };
	if (consoleState[CONSOLE_LOG_PATCHED]) return;
	consoleState[CONSOLE_LOG_PATCHED] = true;
	const originalLog = console.log.bind(console);
	console.log = (...args: unknown[]) => {
		const first = typeof args[0] === "string" ? args[0] : "";
		if (first.includes("Model scope:") && first.includes("Ctrl+P to cycle")) return;
		originalLog(...args);
	};
}

/** The header replaces Pi's resource listing: always run the stock path quiet, so only diagnostics print. */
export function installStartupUiPatch(InteractiveModeComponent: any): void {
	const proto = InteractiveModeComponent?.prototype;
	if (!proto || proto[PATCHED]) return;
	proto[PATCHED] = true;
	proto[ORIGINAL_SHOW_LOADED_RESOURCES] ??= proto.showLoadedResources;

	proto.showLoadedResources = function showQuietLoadedResources(options?: Record<string, unknown>) {
		const original = this[ORIGINAL_SHOW_LOADED_RESOURCES];
		const getQuietStartup = this.settingsManager.getQuietStartup.bind(this.settingsManager);
		this.settingsManager.getQuietStartup = () => true;
		try {
			return original.call(this, { ...options, force: false, showDiagnosticsWhenQuiet: true });
		} finally {
			this.settingsManager.getQuietStartup = getQuietStartup;
		}
	};
}
