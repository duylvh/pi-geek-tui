// Fixed hancore palette (docs/design/geek-ui-spec.md). Shared seam: every scope colors through this.
// Owner after split: frame scope (accent config wiring). Values are spec data — do not tweak per call site.

export const GEEK_PALETTE = {
	bg: "#0c0c0c",
	ink: "#d8d4b4",
	dim: "#a8a385",
	faint: "#525b54",
	num: "#d8785b",
	kw: "#689e80",
	mono: "#88c6a3",
	punct: "#727060",
	rail: "#3a3a34",
	rule: "#2a2a26",
	delMark: "#dd5670",
	delBg: "#251518",
	addMark: "#88c6a3",
	addBg: "#1b221e",
	badgeBg: "#a8a385",
	badgeFg: "#0c0c0c",
} as const;

export type GeekColorRole = keyof typeof GEEK_PALETTE | "accent";

export const GEEK_ACCENT_OPTIONS = ["#dd5670", "#d8785b", "#88c6a3", "#d8d4b4"] as const;
export const DEFAULT_GEEK_ACCENT = GEEK_ACCENT_OPTIONS[0];

/** Set once per session from config (frame scope). */
export function setGeekAccent(hex: string): void {
	throw new Error("not implemented: setGeekAccent (frame scope)");
}

export function geekColor(role: GeekColorRole): string {
	throw new Error("not implemented: geekColor (frame scope)");
}

/** Truecolor foreground for a role; must reset fg only (keep any row background). */
export function geekFg(role: GeekColorRole, text: string): string {
	throw new Error("not implemented: geekFg (frame scope)");
}

/** Truecolor background for a role; must reset bg only. */
export function geekBg(role: GeekColorRole, text: string): string {
	throw new Error("not implemented: geekBg (frame scope)");
}
