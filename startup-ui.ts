import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { GEEK_PREFIX_WIDTH, geekSplitRow } from "./presentation/geek-rows.js";
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

/** Spec §1: two rows, `π pi … session <name>` and an indented dim line with `turn N · last`. */
export function renderStartupHeader(info: StartupHeaderInfo, width: number): string[] {
	const name = info.getSessionName();
	const turns = info.getTurnCount();
	const indent = " ".repeat(GEEK_PREFIX_WIDTH);
	const bodyWidth = Math.max(1, width - GEEK_PREFIX_WIDTH);

	const title = `${geekFg("accent", "π")} ${geekFg("ink", "pi")}`;
	const session = name ? `${geekFg("dim", "session ")}${geekFg("ink", name)}` : "";
	const where = geekFg("dim", `pi — ${displayCwd(info.cwd)}${name ? ` · ${name}` : ""}`);
	const turn = turns > 0 ? geekFg("faint", `turn ${turns} · last`) : "";

	return [
		geekSplitRow(title, session, Math.max(1, width)),
		indent + geekSplitRow(where, turn, bodyWidth),
		"",
	];
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
