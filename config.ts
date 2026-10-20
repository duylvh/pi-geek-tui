import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { homedir } from "os";
import { DEFAULT_GEEK_ACCENT } from "./theme/geek-palette.js";

type CustomWorkingMessageConfig = Record<"working" | "thinking" | "answering" | "running", string>;

export type TasksWidgetStyle = "default" | "compact";

type CollapsedThinkingStyle = "tail" | "label";

const COLLAPSED_THINKING_STYLE_SET: Record<CollapsedThinkingStyle, true> = { tail: true, label: true };

function isCollapsedThinkingStyle(value: unknown): value is CollapsedThinkingStyle {
	return typeof value === "string" && Object.prototype.hasOwnProperty.call(COLLAPSED_THINKING_STYLE_SET, value);
}

function normalizeCollapsedThinkingStyle(value: unknown): CollapsedThinkingStyle {
	if (value === undefined) return DEFAULTS.collapsedThinking;
	return isCollapsedThinkingStyle(value) ? value : DEFAULTS.collapsedThinking;
}

const TASKS_WIDGET_STYLE_SET: Record<TasksWidgetStyle, true> = { default: true, compact: true };

function isTasksWidgetStyle(value: unknown): value is TasksWidgetStyle {
	return typeof value === "string" && Object.prototype.hasOwnProperty.call(TASKS_WIDGET_STYLE_SET, value);
}

function normalizeTasksWidgetStyle(value: unknown): TasksWidgetStyle {
	if (value === undefined) return DEFAULTS.tasksWidgetStyle;
	return isTasksWidgetStyle(value) ? value : DEFAULTS.tasksWidgetStyle;
}

export interface GeekTuiConfig {
	alwaysExpanded: boolean;
	maxExpandedLines: number;
	customWorkingMessage: CustomWorkingMessageConfig;
	/** Accent color: one of GEEK_ACCENT_OPTIONS or any #rgb / #rrggbb hex. */
	accent: string;
	tasksWidgetStyle: TasksWidgetStyle;
	collapsedThinking: CollapsedThinkingStyle;
	forceOSC11: boolean;
	transparentBackground: boolean;
	visibleChatTail: number;
	/** Blank cells added at the left and right edges of the whole TUI. */
	horizontalPadding: number;
	/** Smooth character-by-character reveal of streamed answers (tail fade, adaptive pace). Off = chunked drip. */
	revealAnimation: boolean;
	/** Pasted images become `[Image #N]` text tokens backed by copies in the session dir. Off = host path insertion. */
	imageAttachments: boolean;
}

const DEFAULT_CUSTOM_WORKING_MESSAGE: CustomWorkingMessageConfig = {
	working: "working",
	thinking: "thinking",
	answering: "answering",
	running: "running",
};

const DEFAULTS: GeekTuiConfig = {
	alwaysExpanded: false,
	maxExpandedLines: 50,
	customWorkingMessage: DEFAULT_CUSTOM_WORKING_MESSAGE,
	accent: DEFAULT_GEEK_ACCENT,
	tasksWidgetStyle: "compact",
	collapsedThinking: "tail",
	forceOSC11: false,
	transparentBackground: false,
	visibleChatTail: 30,
	horizontalPadding: 4,
	revealAnimation: true,
	imageAttachments: true,
};

const CONFIG_PATH = join(homedir(), ".pi", "agent", "pi-geek-tui.json");
const MAX_EXPANDED_LINES_LIMIT = 1000;
const DEPRECATED_CONFIG_KEYS = ["fixedUserZoneMouseScroll", "fixedUserZoneSidebar", "fixedUserZone", "presentationStyle", "userZoneStyle", "inputBox", "diffMode", "dimToolOutput"] as const;

let cached: GeekTuiConfig = defaultConfig();
let cachedMtimeMs = -1;
let lastStatAt = 0;
let configIssue: string | undefined;
const STAT_INTERVAL_MS = 1000;

function defaultCustomWorkingMessage(): CustomWorkingMessageConfig {
	return { ...DEFAULT_CUSTOM_WORKING_MESSAGE };
}

function defaultConfig(): GeekTuiConfig {
	return { ...DEFAULTS, customWorkingMessage: defaultCustomWorkingMessage() };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function booleanOrDefault(value: unknown, fallback: boolean): boolean {
	return typeof value === "boolean" ? value : fallback;
}

function maxExpandedLinesOrDefault(value: unknown): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULTS.maxExpandedLines;
	const normalized = Math.floor(value);
	if (normalized < 0) return DEFAULTS.maxExpandedLines;
	return Math.min(normalized, MAX_EXPANDED_LINES_LIMIT);
}

function visibleChatTailOrDefault(value: unknown): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULTS.visibleChatTail;
	const normalized = Math.floor(value);
	if (normalized < 0) return DEFAULTS.visibleChatTail;
	return normalized;
}

function horizontalPaddingOrDefault(value: unknown): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULTS.horizontalPadding;
	const normalized = Math.floor(value);
	if (normalized < 0) return DEFAULTS.horizontalPadding;
	return normalized;
}

function customWorkingMessageOrDefault(value: unknown): CustomWorkingMessageConfig {
	const labels = defaultCustomWorkingMessage();
	if (!isRecord(value)) return labels;
	for (const key of Object.keys(labels) as Array<keyof CustomWorkingMessageConfig>) {
		const label = value[key];
		if (typeof label === "string" && label.trim().length > 0) labels[key] = label;
	}
	return labels;
}

function defaultValueForKey(key: keyof GeekTuiConfig): unknown {
	if (key === "customWorkingMessage") return defaultCustomWorkingMessage();
	return DEFAULTS[key];
}

function backfillCustomWorkingMessage(config: Record<string, unknown>): boolean {
	const value = config.customWorkingMessage;
	if (!isRecord(value)) {
		config.customWorkingMessage = defaultCustomWorkingMessage();
		return true;
	}
	let changed = false;
	for (const key of Object.keys(DEFAULT_CUSTOM_WORKING_MESSAGE) as Array<keyof CustomWorkingMessageConfig>) {
		const label = value[key];
		if (typeof label === "string" && label.trim().length > 0) continue;
		value[key] = DEFAULT_CUSTOM_WORKING_MESSAGE[key];
		changed = true;
	}
	return changed;
}

function normalizeAccent(value: unknown): string {
	if (typeof value !== "string") return DEFAULTS.accent;
	const hex = value.trim().toLowerCase();
	if (/^#[0-9a-f]{6}$/.test(hex)) return hex;
	if (/^#[0-9a-f]{3}$/.test(hex)) return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
	return DEFAULTS.accent;
}

function backfillAccent(config: Record<string, unknown>): boolean {
	const accent = normalizeAccent(config.accent);
	if (accent === config.accent) return false;
	config.accent = accent;
	return true;
}

function backfillTasksWidgetStyle(config: Record<string, unknown>): boolean {
	const value = config.tasksWidgetStyle;
	if (value === undefined) {
		config.tasksWidgetStyle = DEFAULTS.tasksWidgetStyle;
		return true;
	}
	if (isTasksWidgetStyle(value)) return false;
	config.tasksWidgetStyle = DEFAULTS.tasksWidgetStyle;
	return true;
}

function backfillCollapsedThinking(config: Record<string, unknown>): boolean {
	const value = config.collapsedThinking;
	if (value === undefined) {
		config.collapsedThinking = DEFAULTS.collapsedThinking;
		return true;
	}
	if (isCollapsedThinkingStyle(value)) return false;
	config.collapsedThinking = DEFAULTS.collapsedThinking;
	return true;
}

function normalizeConfig(raw: unknown): GeekTuiConfig {
	if (!isRecord(raw)) return defaultConfig();
	const config = raw as Record<string, unknown>;
	return {
		alwaysExpanded: booleanOrDefault(config.alwaysExpanded, DEFAULTS.alwaysExpanded),
		maxExpandedLines: maxExpandedLinesOrDefault(config.maxExpandedLines),
		customWorkingMessage: customWorkingMessageOrDefault(config.customWorkingMessage),
		accent: normalizeAccent(config.accent),
		tasksWidgetStyle: normalizeTasksWidgetStyle(config.tasksWidgetStyle),
		collapsedThinking: normalizeCollapsedThinkingStyle(config.collapsedThinking),
		forceOSC11: booleanOrDefault(config.forceOSC11, DEFAULTS.forceOSC11),
		transparentBackground: booleanOrDefault(config.transparentBackground, DEFAULTS.transparentBackground),
		visibleChatTail: visibleChatTailOrDefault(config.visibleChatTail),
		horizontalPadding: horizontalPaddingOrDefault(config.horizontalPadding),
		revealAnimation: booleanOrDefault(config.revealAnimation, DEFAULTS.revealAnimation),
		imageAttachments: booleanOrDefault(config.imageAttachments, DEFAULTS.imageAttachments),
	};
}

// Write a sibling temp file, then rename over the live file: concurrent Pi starts and
// crashes mid-write never leave a half-written config behind.
function writeConfigAtomic(config: unknown): void {
	const tmpPath = `${CONFIG_PATH}.tmp-${process.pid}`;
	try {
		writeFileSync(tmpPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
		renameSync(tmpPath, CONFIG_PATH);
	} catch (error) {
		try {
			unlinkSync(tmpPath);
		} catch {
			// ignore — nothing to clean up
		}
		throw error;
	}
}

function scaffoldIfMissing(): void {
	if (existsSync(CONFIG_PATH)) return;
	try {
		mkdirSync(dirname(CONFIG_PATH), { recursive: true });
		writeConfigAtomic(defaultConfig());
	} catch {
		// ignore — read path will fall back to normalized defaults
	}
}

function backfillMissingDefaults(raw: unknown): void {
	if (!isRecord(raw)) return;
	const config = raw as Record<string, unknown>;
	let changed = false;
	for (const key of DEPRECATED_CONFIG_KEYS) {
		if (!(key in config)) continue;
		delete config[key];
		changed = true;
	}
	for (const key of Object.keys(DEFAULTS) as Array<keyof GeekTuiConfig>) {
		if (key in config) continue;
		config[key] = defaultValueForKey(key);
		changed = true;
	}
	if (backfillCustomWorkingMessage(config)) changed = true;
	if (backfillAccent(config)) changed = true;
	if (backfillTasksWidgetStyle(config)) changed = true;
	if (backfillCollapsedThinking(config)) changed = true;
	if (!changed) return;
	try {
		writeConfigAtomic(config);
	} catch {
		// ignore — read path will keep using normalized defaults
	}
}

function describeInvalidJson(error: SyntaxError): string {
	return `pi-geek-tui: ${CONFIG_PATH} is not valid JSON (${error.message})`;
}

// Why the live file is being ignored right now (undefined while it parses). Set by loadConfig,
// so callers read it from event handlers instead of render paths. Callers append what that means for them.
export function getConfigIssue(): string | undefined {
	return configIssue;
}

export function loadConfig(): GeekTuiConfig {
	const now = Date.now();
	if (now - lastStatAt < STAT_INTERVAL_MS) return cached;
	lastStatAt = now;

	let mtimeMs = -1;
	try {
		mtimeMs = statSync(CONFIG_PATH).mtimeMs;
	} catch {
		scaffoldIfMissing();
		try {
			mtimeMs = statSync(CONFIG_PATH).mtimeMs;
		} catch {
			cached = defaultConfig();
			cachedMtimeMs = -1;
			return cached;
		}
	}

	if (mtimeMs === cachedMtimeMs) return cached;
	cachedMtimeMs = mtimeMs;
	try {
		const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
		cached = normalizeConfig(raw);
		backfillMissingDefaults(raw);
		configIssue = undefined;
	} catch (error) {
		if (error instanceof SyntaxError) {
			// A typo mid-session must not reset every option: keep the last good config and the file as is.
			configIssue = describeInvalidJson(error);
		} else {
			cached = defaultConfig();
		}
	}
	return cached;
}
