#!/usr/bin/env node
/**
 * Input-head live word (spec §8): shimmer band, decode-on-change, constant width, and "no timer when idle".
 * Pure frames use an injected clock; the ticker check drives the real GeekEditor.
 */
import { rmSync } from "node:fs";
import { join } from "node:path";
import { visibleWidth } from "@earendil-works/pi-tui";
import { buildSmoke } from "./smoke-build.mjs";

const built = buildSmoke("geek-shimmer-smoke", ["editor/shimmer.ts", "editor/geek-editor.ts", "editor/live-state.ts"]);
const { shimmerWord, bandWeight, settledCount, DECODE_MS, SWEEP_MS, PAUSE_MS } = await built.importBuilt("editor/shimmer.js");
const { GeekEditor } = await built.importBuilt("editor/geek-editor.js");
const { setLiveState } = await built.importBuilt("editor/live-state.js");

const failures = [];
const expect = (name, condition, detail = "") => { if (!condition) failures.push(`${name}${detail ? `: ${detail}` : ""}`); };
const strip = (text) => String(text).replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
const rgbs = (text) => [...text.matchAll(/\x1b\[38;2;(\d+);(\d+);(\d+)m/g)].map((m) => Number(m[1])); // red channel per char
const GLYPHS = "▚▞░▒#%/\\";

// --- shimmer: the band sweeps left→right, 3 chars wide, then pauses
const word = "thinking";
const T0 = 10_000;
const afterDecode = (ms) => T0 + DECODE_MS + ms;
const weights = (ms) => Array.from(word, (_, i) => bandWeight(i, word.length, ms));
const peak = (ms) => weights(ms).indexOf(Math.max(...weights(ms)));
expect("band starts left", peak(SWEEP_MS * 0.15) <= 1);
expect("band moves right monotonically", [0.2, 0.4, 0.6, 0.8].map((f) => peak(SWEEP_MS * f)).every((p, i, all) => i === 0 || p >= all[i - 1]));
expect("band ends right", peak(SWEEP_MS * 0.9) >= word.length - 2);
expect("band is ~3 chars wide", weights(SWEEP_MS * 0.5).filter((w) => w > 0).length <= 3);
expect("pause: no band between sweeps", weights(SWEEP_MS + PAUSE_MS / 2).every((w) => w === 0));
expect("sweeps repeat", JSON.stringify(weights(300)) === JSON.stringify(weights(300 + SWEEP_MS + PAUSE_MS)));
const mid = shimmerWord(word, afterDecode(SWEEP_MS * 0.5), T0, "truecolor");
const reds = rgbs(mid);
expect("band chars are brighter than the rest (dim↔ink blend)", Math.max(...reds) > Math.min(...reds) && Math.max(...reds) <= 0xd8);
const paused = rgbs(shimmerWord(word, afterDecode(SWEEP_MS + 100), T0, "truecolor"));
expect("paused word is uniformly dim", new Set(paused).size === 1);
expect("256-color mode emits 38;5", /\x1b\[38;5;\d+m/.test(shimmerWord(word, afterDecode(500), T0, "256color")) && !/38;2;/.test(shimmerWord(word, afterDecode(500), T0, "256color")));

// --- decode: chars settle left→right, unsettled ones are scramble glyphs
const decodeFrames = [0, 0.25, 0.5, 0.75, 0.99].map((f) => strip(shimmerWord(word, T0 + DECODE_MS * f, T0, "truecolor")));
const settledNow = (frame) => Array.from(frame).filter((ch, i) => ch === word[i] && !GLYPHS.includes(ch)).length;
expect("decode starts fully scrambled", Array.from(decodeFrames[0]).every((ch) => GLYPHS.includes(ch)), decodeFrames[0]);
expect("only scramble glyphs fill unsettled slots", decodeFrames.every((frame) => Array.from(frame).every((ch, i) => ch === word[i] || GLYPHS.includes(ch))));
expect("settled prefix grows left→right", decodeFrames.every((frame, i) => i === 0 || settledCount(word.length, DECODE_MS * [0, 0.25, 0.5, 0.75, 0.99][i]) >= settledCount(word.length, DECODE_MS * [0, 0.25, 0.5, 0.75, 0.99][i - 1])) && decodeFrames[3].startsWith(word.slice(0, 5)), JSON.stringify(decodeFrames));
expect("decode finishes into the word", strip(shimmerWord(word, T0 + DECODE_MS, T0, "truecolor")) === word);
expect("scramble is deterministic per frame", shimmerWord(word, T0 + 60, T0, "truecolor") === shimmerWord(word, T0 + 60, T0, "truecolor"));

// --- constant visible width across every frame (no jitter), several words
for (const text of ["thinking", "working", "running", "answering", "a b"]) {
	const widths = new Set();
	for (let t = 0; t < 3500; t += 17) widths.add(visibleWidth(shimmerWord(text, T0 + t, T0, "truecolor")));
	expect(`width constant for "${text}"`, widths.size === 1 && [...widths][0] === visibleWidth(text), JSON.stringify([...widths]));
}

// --- editor: no ticker while idle, ticker while live, stops again after
const realNow = Date.now;
let renders = 0;
const editorTheme = { borderColor: (s) => s, selectList: { selectedPrefix: (s) => s, selectedText: (s) => s, description: (s) => s, scrollInfo: (s) => s, noMatch: (s) => s } };
const editor = new GeekEditor({ requestRender() { renders++; }, terminal: { rows: 40, columns: 100 } }, editorTheme, { matches: () => false, getKeys: () => [] }, {
	cwd: join(built.workDir, "proj"), getContextUsage: () => undefined, getModelInfo: () => undefined, getBranch: () => null, getFooterStatus: () => null, getTokenUsage: () => null,
});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
setLiveState(undefined);
editor.render(100);
await sleep(250);
expect("idle: render does not start a repaint loop", renders === 0, `renders=${renders}`);
setLiveState("thinking");
editor.render(100);
await sleep(300);
const liveRenders = renders;
expect("live: repaints at ~70ms", liveRenders >= 3 && liveRenders <= 6, `renders=${liveRenders}`);
const headRows = [];
for (let t = 0; t < 1500; t += 70) {
	Date.now = () => realNow() + t;
	const head = editor.render(100).map(strip).find((row) => row.includes("thinking") || /[▚▞░▒#%/\\]/.test(row.slice(60)));
	if (head) headRows.push(visibleWidth(head));
}
Date.now = realNow;
expect("head row keeps its width while animating", headRows.length > 0 && new Set(headRows).size === 1, JSON.stringify(headRows));
setLiveState(undefined);
editor.render(100);
const stopped = renders;
await sleep(250);
expect("idle again: ticker is cleared", renders === stopped, `renders ${stopped} → ${renders}`);

console.log(shimmerWord("thinking", afterDecode(SWEEP_MS * 0.4), T0, "truecolor").replace(/\x1b/g, "␛"));
for (const f of [0, 0.4, 0.8]) console.log(`decode ${f}: ${strip(shimmerWord("running", T0 + DECODE_MS * f, T0, "truecolor"))}`);

rmSync(built.workDir, { recursive: true, force: true });
if (failures.length) {
	console.error(`geek shimmer smoke FAILED (${failures.length}):\n- ${failures.join("\n- ")}`);
	process.exit(1);
}
console.log("geek shimmer smoke ok");
