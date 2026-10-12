// Compatibility shim for the former pi-themes "extras" reader. The look is fixed now
// (theme/geek-palette.ts); nothing is read from theme files on disk anymore.
// Remaining callers should move to geek-palette and then this file goes away.

import { GEEK_PALETTE } from "./geek-palette.js";

const DEFAULT_EXTRAS: Record<string, string> = {
	assistantPrefix: "•",
	userPrefix: "❯",
	userPrefixColor: "accent",
	dividerChar: "─",
	showDivider: "true",
	quoteStyle: "false",
	quoteChar: "┆",
	gitInsertionColor: GEEK_PALETTE.addMark,
	gitDeletionColor: GEEK_PALETTE.delMark,
	collapsedThinkingTailColor: "muted",
};

export function setFullTheme(_theme: any, _force = false): void {}

export function getThemeExtra(_theme: any, key: string): string {
	return DEFAULT_EXTRAS[key] ?? "";
}

export function getThemePageBackground(_theme: any): string {
	return GEEK_PALETTE.bg;
}

export function getThemeVarBackground(_theme: any, _varName: string): string {
	return "";
}
