// Live-state word of the input head (spec §8): hancore-style "light" text instead of a spark glyph.
//  - shimmer: every char is `dim`; a ~3-char band of `ink` sweeps left→right (cosine falloff, RGB blend),
//    ~1.2s per sweep, then a short pause
//  - decode: when the word changes, unsettled chars show random glyphs and settle left→right (~300ms)
// Pure: time is passed in, so frames are deterministic. Output width always equals the word's width.
import { geekColor } from "../theme/geek-palette.js";

export type ColorMode = "truecolor" | "256color";

export const SWEEP_MS = 1200;
export const PAUSE_MS = 400;
export const DECODE_MS = 300;
const BAND_HALF_WIDTH = 1.5; // cosine falloff radius → ~3 chars wide
const SCRAMBLE_GLYPHS = "▚▞░▒#%/\\";
const SCRAMBLE_STEP_MS = 50; // glyphs re-roll at ~20fps, not every tick

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

/** Band weight (0..1) of char `index` at time `t` since the animation start. */
export function bandWeight(index: number, length: number, t: number): number {
	const cycle = SWEEP_MS + PAUSE_MS;
	const phase = t % cycle;
	if (phase >= SWEEP_MS) return 0; // pause
	const travel = length + 2 * BAND_HALF_WIDTH;
	const center = -BAND_HALF_WIDTH + (phase / SWEEP_MS) * travel;
	const distance = Math.abs(index - center);
	return distance >= BAND_HALF_WIDTH ? 0 : 0.5 * (1 + Math.cos((Math.PI * distance) / BAND_HALF_WIDTH));
}

/** Index of the first char still scrambled at `sinceChange` ms after the word changed (length = fully settled). */
export function settledCount(length: number, sinceChange: number): number {
	if (sinceChange >= DECODE_MS) return length;
	return Math.max(0, Math.min(length, Math.floor((sinceChange / DECODE_MS) * length)));
}

function scrambleGlyph(index: number, sinceChange: number): string {
	const step = Math.floor(sinceChange / SCRAMBLE_STEP_MS);
	// small integer hash: stable for a given (char, step), different between chars and steps
	const hash = Math.imul(index + 1, 2654435761) ^ Math.imul(step + 1, 40503);
	return SCRAMBLE_GLYPHS[Math.abs(hash) % SCRAMBLE_GLYPHS.length]!;
}

/**
 * Styled word for one frame. `sinceChange` = ms since the word last changed (decode phase when < DECODE_MS),
 * `t` = ms of shimmer time (sweep starts once decoding is done).
 */
export function shimmerWord(word: string, now: number, changedAt: number, mode: ColorMode = detectColorMode()): string {
	const dim = parseHex(geekColor("dim"));
	const ink = parseHex(geekColor("ink"));
	if (!dim || !ink || word === "") return word;
	const chars = Array.from(word);
	const sinceChange = Math.max(0, now - changedAt);
	const settled = settledCount(chars.length, sinceChange);
	const shimmerTime = Math.max(0, sinceChange - DECODE_MS);
	let out = "";
	for (let i = 0; i < chars.length; i++) {
		if (i >= settled && chars[i] !== " ") {
			out += `${fg(dim, mode)}${scrambleGlyph(i, sinceChange)}`;
			continue;
		}
		const w = sinceChange < DECODE_MS ? 0 : bandWeight(i, chars.length, shimmerTime);
		const blended = dim.map((value, channel) => Math.round(value + (ink[channel]! - value) * w)) as Rgb;
		out += `${fg(blended, mode)}${chars[i]}`;
	}
	return `${out}\x1b[39m`;
}
