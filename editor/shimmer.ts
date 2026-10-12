// Live-state word of the input head (spec §8): hancore-style matrix text.
//  - churn: while live, every tick ~22-34% of the word's positions show a random glyph (`ink`, bold) instead
//    of their letter (`dim`); the flipping set is re-rolled each tick so it never freezes. A glyph that just
//    went back to its letter flashes `ink` for one tick.
//  - resolve beat: the last RESOLVE_MS of every CYCLE_MS nothing flips, so the word reads cleanly.
//  - decode: when the word changes, unsettled chars are glyphs and settle left→right (~300ms).
// Pure: time is passed in and the "random" source is a hash, so frames are deterministic. Every glyph is
// single-width, so the output width always equals the word's width.
import { geekColor } from "../theme/geek-palette.js";

export type ColorMode = "truecolor" | "256color";

export const TICK_MS = 70; // glyph re-roll rate; matches the editor's repaint ticker
export const DECODE_MS = 300;
export const CYCLE_MS = 2000;
export const RESOLVE_MS = 350;
const MIN_RATE = 0.22;
const MAX_RATE = 0.34;
export const GLYPHS = "▚▞░▒#%/\\<>*+=01xz$&";

type Rgb = [number, number, number];

function parseHex(hex: string): Rgb | undefined {
	const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
	return match ? [parseInt(match[1]!, 16), parseInt(match[2]!, 16), parseInt(match[3]!, 16)] : undefined;
}

function to256(rgb: Rgb): number {
	const level = (value: number) => Math.round((value / 255) * 5);
	return 16 + 36 * level(rgb[0]) + 6 * level(rgb[1]) + level(rgb[2]);
}

function fg(rgb: Rgb, mode: ColorMode): string {
	return mode === "truecolor" ? `\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m` : `\x1b[38;5;${to256(rgb)}m`;
}

export function detectColorMode(env: Record<string, string | undefined> = process.env): ColorMode {
	const hint = `${env.COLORTERM ?? ""}`.toLowerCase();
	return hint.includes("truecolor") || hint.includes("24bit") || !env.TERM?.includes("256") ? "truecolor" : "256color";
}

/** Index of the first char still scrambled at `sinceChange` ms after the word changed (length = fully settled). */
export function settledCount(length: number, sinceChange: number): number {
	if (sinceChange >= DECODE_MS) return length;
	return Math.max(0, Math.min(length, Math.floor((sinceChange / DECODE_MS) * length)));
}

/** Deterministic unit-interval hash of (a, b, c). */
function unit(a: number, b: number, c = 0): number {
	let h = Math.imul(a + 1, 2654435761) ^ Math.imul(b + 1, 40503) ^ Math.imul(c + 1, 2246822519);
	h = Math.imul(h ^ (h >>> 15), 2246822507);
	h = Math.imul(h ^ (h >>> 13), 3266489909);
	return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function glyphFor(index: number, tick: number, letter: string): string {
	const start = Math.floor(unit(index, tick, 7) * GLYPHS.length);
	const glyph = GLYPHS[start]!;
	return glyph === letter ? GLYPHS[(start + 1) % GLYPHS.length]! : glyph;
}

/** Positions (indices of non-space chars) that flip to glyphs during `tick`. */
function flippedAt(chars: string[], tick: number): Set<number> {
	const candidates = chars.map((ch, i) => i).filter((i) => chars[i] !== " ");
	if (candidates.length === 0) return new Set();
	const rate = MIN_RATE + (MAX_RATE - MIN_RATE) * unit(tick, 99);
	const count = Math.max(1, Math.min(candidates.length, Math.round(candidates.length * rate)));
	candidates.sort((a, b) => unit(a, tick, 3) - unit(b, tick, 3));
	return new Set(candidates.slice(0, count));
}

function inResolveBeat(matrixTime: number): boolean {
	return matrixTime % CYCLE_MS >= CYCLE_MS - RESOLVE_MS;
}

/** Styled word for one frame. `changedAt` = when the word last changed (decode phase for DECODE_MS). */
export function shimmerWord(word: string, now: number, changedAt: number, mode: ColorMode = detectColorMode()): string {
	const dim = parseHex(geekColor("dim"));
	const ink = parseHex(geekColor("ink"));
	if (!dim || !ink || word === "") return word;
	const chars = Array.from(word);
	const sinceChange = Math.max(0, now - changedAt);
	const glyph = (index: number, tick: number) => `\x1b[1m${fg(ink, mode)}${glyphFor(index, tick, chars[index]!)}\x1b[22m`;
	const letter = (index: number, flash: boolean) => `${fg(flash ? ink : dim, mode)}${chars[index]}`;

	let out = "";
	if (sinceChange < DECODE_MS) {
		const settled = settledCount(chars.length, sinceChange);
		const tick = Math.floor(sinceChange / TICK_MS);
		for (let i = 0; i < chars.length; i++) out += i >= settled && chars[i] !== " " ? glyph(i, tick) : letter(i, false);
	} else {
		const matrixTime = sinceChange - DECODE_MS;
		const tick = Math.floor(matrixTime / TICK_MS);
		const flipped = inResolveBeat(matrixTime) ? new Set<number>() : flippedAt(chars, tick);
		const before = tick > 0 && !inResolveBeat(matrixTime - TICK_MS) ? flippedAt(chars, tick - 1) : new Set<number>();
		for (let i = 0; i < chars.length; i++) out += flipped.has(i) ? glyph(i, tick) : letter(i, before.has(i));
	}
	return `${out}\x1b[39m`;
}
