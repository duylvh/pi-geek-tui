#!/usr/bin/env node
/**
 * Input-head live word (spec §8): matrix scramble, decode-on-change, resolve beats, constant width, and
 * "no timer when idle". Pure frames use an injected clock; the ticker check drives the real GeekEditor.
 */
import { rmSync } from "node:fs";
import { join } from "node:path";
import { visibleWidth } from "@earendil-works/pi-tui";
import { buildSmoke } from "./smoke-build.mjs";

const built = buildSmoke("geek-shimmer-smoke", ["editor/shimmer.ts", "editor/geek-editor.ts", "editor/live-state.ts"]);
const { shimmerWord, settledCount, DECODE_MS, TICK_MS, CYCLE_MS, RESOLVE_MS, GLYPHS } = await built.importBuilt("editor/shimmer.js");
const { GeekEditor } = await built.importBuilt("editor/geek-editor.js");
const { setLiveState } = await built.importBuilt("editor/live-state.js");

const failures = [];
const expect = (name, condition, detail = "") => { if (!condition) failures.push(`${name}${detail ? `: ${detail}` : ""}`); };
const strip = (text) => String(text).replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
const DIM = "38;2;168;163;133";
const INK = "38;2;216;212;180";
const T0 = 10_000;
const frame = (word, matrixMs, mode = "truecolor") => shimmerWord(word, T0 + DECODE_MS + matrixMs, T0, mode);
const flips = (text) => (text.match(/\x1b\[1m/g) ?? []).length;
const cleanBeat = CYCLE_MS - RESOLVE_MS;
const churnTicks = (from, to) => { const out = []; for (let t = from; t < to; t += TICK_MS) out.push(t); return out; };

// --- churn: bounded share of positions flip, every tick, positions move
for (const word of ["thinking", "working", "running", "answering"]) {
	const n = word.length;
	const counts = churnTicks(0, cleanBeat - TICK_MS).map((t) => flips(frame(word, t)));
	expect(`"${word}": every churn frame flips at least one and at most 40%`, counts.every((c) => c >= 1 && c <= Math.ceil(n * 0.4)), JSON.stringify(counts));
	const mean = counts.reduce((a, b) => a + b, 0) / counts.length / n;
	expect(`"${word}": mean flip share within 20-36%`, mean >= 0.2 && mean <= 0.36, String(mean));
}
const sets = new Set(churnTicks(0, 1500).map((t) => Array.from(strip(frame("thinking", t))).map((ch, i) => (ch === "thinking"[i] ? "." : "x")).join("")));
expect("flipped positions churn (many different patterns, never frozen)", sets.size >= 12, `${sets.size} patterns`);
const texts = churnTicks(0, 1500).map((t) => strip(frame("thinking", t)));
expect("consecutive ticks differ (glyphs re-roll every tick)", texts.every((text, i) => i === 0 || text !== texts[i - 1]));
expect("frame is stable within one tick", frame("thinking", 140) === frame("thinking", 140 + TICK_MS - 1));
expect("deterministic for the same clock", frame("thinking", 777) === frame("thinking", 777));

// --- glyphs: single-width, from the set, never the letter they replace; colors
for (const t of churnTicks(0, 3500)) {
	const out = frame("thinking", t);
	const plain = strip(out);
	expect(`width 8 at +${t}ms`, visibleWidth(out) === 8 && Array.from(plain).length === 8);
	for (const [i, ch] of Array.from(plain).entries()) {
		if (ch !== "thinking"[i]) expect(`glyph "${ch}" belongs to the set`, GLYPHS.includes(ch) && visibleWidth(ch) === 1);
	}
}
const sample = frame("thinking", 200);
expect("flipping glyphs are bold ink", sample.includes(`\x1b[1m\x1b[${INK}m`));
expect("true letters are dim", sample.includes(`\x1b[${DIM}m`) && !/\x1b\[38;2;(?!168;163;133|216;212;180)/.test(sample));
expect("256-color mode emits 38;5 only", /\x1b\[38;5;\d+m/.test(frame("thinking", 200, "256color")) && !/38;2;/.test(frame("thinking", 200, "256color")));

// --- resolve beat: clean word, every cycle; churn resumes after
for (const cycle of [0, 1, 2]) {
	const base = cycle * CYCLE_MS;
	for (const offset of [cleanBeat + TICK_MS * 2, cleanBeat + 200, CYCLE_MS - 20]) {
		const out = frame("thinking", base + offset);
		expect(`cycle ${cycle}: resolve beat shows the clean word (+${offset}ms)`, strip(out) === "thinking" && flips(out) === 0 && !out.includes(INK), out.replace(/\x1b/g, "␛"));
	}
	expect(`cycle ${cycle}: churn resumes after the beat`, flips(frame("thinking", base + CYCLE_MS + TICK_MS * 2)) >= 1);
	expect(`cycle ${cycle}: churning before the beat`, flips(frame("thinking", base + 500)) >= 1);
}
expect("first tick of the beat flashes the just-resolved letters in ink (no bold)", (() => {
	const out = frame("thinking", Math.ceil(cleanBeat / TICK_MS) * TICK_MS);
	return flips(out) === 0 && out.includes(INK);
})());

// --- decode on word change: unsettled = glyphs, settled prefix grows, then churn takes over
const decode = [0, 0.25, 0.5, 0.75, 0.99].map((f) => strip(shimmerWord("thinking", T0 + DECODE_MS * f, T0, "truecolor")));
expect("decode starts fully scrambled", Array.from(decode[0]).every((ch) => GLYPHS.includes(ch)), decode[0]);
expect("decode settles left→right", decode.every((text, i) => i === 0 || Array.from(text).filter((ch, k) => ch === "thinking"[k]).length >= 0) && decode[3].startsWith("thinking".slice(0, 5)), JSON.stringify(decode));
expect("settled count is monotonic", [0, 60, 120, 180, 240, 299, 300].every((ms, i, all) => i === 0 || settledCount(8, ms) >= settledCount(8, all[i - 1])) && settledCount(8, DECODE_MS) === 8);
expect("decode glyphs are ink, settled letters dim", shimmerWord("thinking", T0 + 150, T0, "truecolor").includes(`\x1b[1m\x1b[${INK}m`) && shimmerWord("thinking", T0 + 150, T0, "truecolor").includes(`\x1b[${DIM}m`));

// --- constant visible width across every frame (decode, churn, beat), several words
for (const text of ["thinking", "working", "running", "answering", "a b"]) {
	const widths = new Set();
	for (let t = 0; t < 6500; t += 17) widths.add(visibleWidth(shimmerWord(text, T0 + t, T0, "truecolor")));
	expect(`width constant for "${text}"`, widths.size === 1 && [...widths][0] === visibleWidth(text), JSON.stringify([...widths]));
}
expect("spaces never flip", Array.from({ length: 40 }, (_, k) => strip(frame("a b", k * TICK_MS))).every((text) => text[1] === " "));

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
	const head = editor.render(100).map(strip)[0];
	if (head) headRows.push(visibleWidth(head));
}
Date.now = realNow;
expect("head row keeps its width while animating", headRows.length > 0 && new Set(headRows).size === 1, JSON.stringify(headRows));
setLiveState(undefined);
editor.render(100);
const stopped = renders;
await sleep(250);
expect("idle again: ticker is cleared", renders === stopped, `renders ${stopped} → ${renders}`);

for (const t of [0, 70, 140, 1650, 1750]) console.log(`+${String(t).padStart(4)}ms: ${strip(frame("thinking", t))}   ${frame("thinking", t).replace(/\x1b/g, "␛").slice(0, 70)}`);
console.log(`decode: ${[0, 0.4, 0.8].map((f) => strip(shimmerWord("running", T0 + DECODE_MS * f, T0, "truecolor"))).join(" → ")}`);

rmSync(built.workDir, { recursive: true, force: true });
if (failures.length) {
	console.error(`geek shimmer smoke FAILED (${failures.length}):\n- ${failures.join("\n- ")}`);
	process.exit(1);
}
console.log("geek shimmer smoke ok");
