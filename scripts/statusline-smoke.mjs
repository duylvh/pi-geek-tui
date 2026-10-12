#!/usr/bin/env node
/**
 * Statusline smoke (editor/statusline.ts): exact width, badge in the prefix ending on the rail column,
 * model at body col 8, right edge aligned, sacrifice order, status truncation, model cap.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { visibleWidth } from "@earendil-works/pi-tui";

const repoRoot = process.cwd();
const workDir = join(repoRoot, ".pi", "statusline-smoke");
const buildDir = join(workDir, "build");
const tsc = join(repoRoot, "node_modules", "typescript", "lib", "tsc.js");
rmSync(workDir, { recursive: true, force: true });
mkdirSync(buildDir, { recursive: true });
writeFileSync(join(buildDir, "package.json"), '{"type":"module"}\n', "utf8");
const build = spawnSync(process.execPath, [
	tsc, "--target", "ES2022", "--module", "NodeNext", "--moduleResolution", "NodeNext",
	"--outDir", buildDir, "--rootDir", repoRoot, "--skipLibCheck", "--noImplicitAny", "false", "--lib", "ES2022",
	join(repoRoot, "editor", "statusline.ts"),
], { cwd: repoRoot, encoding: "utf8" });
if (build.status !== 0) throw new Error(`tsc failed\n${build.stdout}\n${build.stderr}`);
const { renderStatusline } = await import(pathToFileURL(join(buildDir, "editor", "statusline.js")).href);

const strip = (text) => String(text).replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
const failures = [];
const expect = (name, condition, detail = "") => { if (!condition) failures.push(`${name}${detail ? `: ${detail}` : ""}`); };
const ACCENT_BG = "\x1b[48;2;221;86;112m";
const NUM_BG = "\x1b[48;2;216;120;91m";
const base = {
	provider: "zai", modelId: "glm-5.3", reasoning: true, thinkingLevel: "high",
	contextWindow: 1_000_000, tokens: 41_000, percent: 4.1, cacheHitPercent: 82.4, status: "○ 🐴 ponytail: ⚡ FULL",
};
const row = (input, width) => strip(renderStatusline({ ...base, ...input }, width));

// Full layout at 120.
const full = row({}, 120);
expect("full row: badge ends at the rail column, model starts at body col 8", full.slice(0, 8) === "  HIGH  " && full.slice(8).startsWith("zai · glm-5.3"), JSON.stringify(full.slice(0, 30)));
expect("right side: tokens/window ctx% · CH, then statuses, ends at the edge", /41k\/1\.0M 4% · CH 82%  ○ 🐴 ponytail: ⚡ FULL$/.test(full), full);

for (const width of [120, 100, 80, 70, 60, 50, 40, 30, 20, 12, 9, 8]) {
	for (const input of [{}, { status: "" }, { thinkingLevel: "xhigh" }, { bashMode: true }, { reasoning: false }, { modelId: "m".repeat(80) }, { tokens: null, percent: null, cacheHitPercent: null }, { provider: undefined, modelId: undefined }, { status: "x".repeat(200) }]) {
		const out = renderStatusline({ ...base, ...input }, width);
		expect(`exactly ${width} cells ${JSON.stringify(input).slice(0, 40)}`, visibleWidth(out) === width, `${visibleWidth(out)} ${JSON.stringify(strip(out))}`);
	}
}

// Badge: reverse-video block ending on the rail column; labels abbreviated to <= 7 cells.
for (const [level, label] of [["off", "OFF"], ["minimal", "MIN"], ["low", "LOW"], ["medium", "MED"], ["high", "HIGH"], ["xhigh", "XHIGH"]]) {
	const out = renderStatusline({ ...base, thinkingLevel: level }, 120);
	const plain = strip(out);
	const block = ` ${label} `;
	expect(`${level}: block ends at col 6 and is accent`, plain.indexOf(block) + block.length === 7 && plain[7] === " " && out.includes(`${ACCENT_BG}`), JSON.stringify(plain.slice(0, 12)));
	expect(`${level}: model still starts at col 8`, plain.slice(8).startsWith("zai · glm-5.3"));
}
expect("bash mode shows a BASH block in the num colour", (() => { const out = renderStatusline({ ...base, bashMode: true }, 120); return strip(out).startsWith("  BASH  ") && out.includes(NUM_BG) && !strip(out).includes("HIGH"); })());
expect("no thinking support: prefix blank, no accent block", (() => { const out = renderStatusline({ ...base, reasoning: false }, 120); return strip(out).startsWith(" ".repeat(8) + "zai") && !out.includes(ACCENT_BG); })());

// Sacrifice order as the width shrinks: provider → CH% → tokens → statuses (cut, then hidden) → model id. ctx% stays.
const sweep = [];
for (let width = 110; width >= 20; width--) sweep.push({ width, text: row({}, width) });
const firstMissing = (needle) => sweep.find((r) => !r.text.includes(needle))?.width ?? 0;
const dropProvider = firstMissing("zai"), dropCache = firstMissing("CH 82%"), dropTokens = firstMissing("41k/1.0M");
const cutStatus = firstMissing("ponytail: ⚡ FULL"), hideStatus = sweep.find((r) => !r.text.includes("🐴"))?.width ?? 0;
expect("order: provider > CH > tokens > status cut > status hidden", dropProvider > dropCache && dropCache > dropTokens && dropTokens > cutStatus && cutStatus > hideStatus, JSON.stringify({ dropProvider, dropCache, dropTokens, cutStatus, hideStatus }));
expect("ctx% and the whole model id survive every width from 110 to 20", sweep.every((r) => r.text.includes("4%") && r.text.includes("glm-5.3")), sweep.find((r) => !r.text.includes("4%") || !r.text.includes("glm-5.3"))?.text);
expect("a row that cuts or hides the status has already lost tokens and CH", sweep.filter((r) => r.width <= cutStatus).every((r) => !r.text.includes("41k") && !r.text.includes("CH")));
const clipped = Array.from({ length: 91 }, (_, i) => row({ modelId: "claude-sonnet-long-model" }, 110 - i)).filter((text) => !text.includes("claude-sonnet-long-model"));
expect("model id is clipped only after status and tokens are gone", clipped.length > 0 && clipped.every((text) => !text.includes("🐴") && !text.includes("41k")), clipped[0]);

// Statuses: whole when they fit, `…`-cut when tight, absent when under 6 cells; never wrap.
expect("status shown whole when room", row({}, 120).endsWith("ponytail: ⚡ FULL"));
const tight = sweep.map((r) => r.text).find((text) => text.includes("…") && text.includes("🐴"));
expect("status is cut with … when tight", Boolean(tight), String(tight));
expect("long status is cut with … and the row keeps its width", row({ status: "y".repeat(300) }, 100).endsWith("…") && visibleWidth(row({ status: "y".repeat(300) }, 100)) === 100);

// Model cap and no-usage state.
expect("model id is capped at 40 cells with …", row({ modelId: "m".repeat(80), provider: undefined, status: "" }, 120).includes("m".repeat(39) + "…"));
expect("before first usage the metrics read —", row({ tokens: null, percent: null, cacheHitPercent: null }, 120).includes("—") && !row({ tokens: null, percent: null, cacheHitPercent: null }, 120).includes("%"));

console.log("--- statusline @120 / @70 / @50 ---");
for (const width of [120, 70, 50]) console.log(renderStatusline(base, width));
rmSync(workDir, { recursive: true, force: true });
if (failures.length) {
	console.error(`statusline smoke FAILED (${failures.length}):\n  - ${failures.join("\n  - ")}`);
	process.exit(1);
}
console.log("statusline smoke ok");
