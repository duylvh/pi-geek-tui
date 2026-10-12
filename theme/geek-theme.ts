// Host theme built from GEEK_PALETTE, so everything Pi colors through its theme (markdown, selectors,
// highlightCode syntax colors, diff colors) matches the geek look. Built in code, not shipped as JSON:
// the accent is configurable, no theme discovery is needed, and `ui.setTheme(<Theme instance>)` is
// session-only (Pi persists to settings.json only when setTheme gets a theme NAME).

import { Theme, type ThemeColor } from "@earendil-works/pi-coding-agent";
import { GEEK_PALETTE as P, geekColor } from "./geek-palette.js";

export const GEEK_THEME_NAME = "geek-hancore";

function geekForeground(): Record<ThemeColor, string> {
	const accent = geekColor("accent");
	return {
		accent,
		border: P.rule,
		borderAccent: accent,
		borderMuted: P.rail,
		success: P.mono,
		error: P.delMark,
		warning: P.num,
		muted: P.dim,
		dim: P.faint,
		text: P.ink,
		thinkingText: P.dim,
		userMessageText: P.ink,
		customMessageText: P.ink,
		customMessageLabel: P.kw,
		toolTitle: P.ink,
		toolOutput: P.dim,
		mdHeading: accent,
		mdLink: P.kw,
		mdLinkUrl: P.faint,
		mdCode: P.mono,
		mdCodeBlock: P.ink,
		mdCodeBlockBorder: P.faint,
		mdQuote: P.dim,
		mdQuoteBorder: P.rail,
		mdHr: P.rule,
		mdListBullet: accent,
		toolDiffAdded: P.addMark,
		toolDiffRemoved: P.delMark,
		toolDiffContext: P.faint,
		syntaxComment: P.faint,
		syntaxKeyword: P.kw,
		syntaxFunction: P.ink,
		syntaxVariable: P.ink,
		syntaxString: P.mono,
		syntaxNumber: P.num,
		syntaxType: P.kw,
		syntaxOperator: P.punct,
		syntaxPunctuation: P.punct,
		thinkingOff: P.rail,
		thinkingMinimal: P.faint,
		thinkingLow: P.dim,
		thinkingMedium: P.kw,
		thinkingHigh: P.mono,
		thinkingXhigh: accent,
		bashMode: P.num,
	};
}

const BACKGROUNDS: Record<string, string> = {
	selectedBg: P.rail,
	userMessageBg: P.bg,
	customMessageBg: P.bg,
	toolPendingBg: P.bg,
	toolSuccessBg: P.addBg,
	toolErrorBg: P.delBg,
};

/** Fresh theme for the current accent. `colorMode` follows the host theme (truecolor / 256color). */
export function createGeekTheme(colorMode: "truecolor" | "256color" = "truecolor"): Theme {
	return new Theme(geekForeground(), BACKGROUNDS, colorMode, { name: GEEK_THEME_NAME });
}
