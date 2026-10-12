#!/usr/bin/env node
/**
 * Frame smoke: renders the startup header, input zone and footer (spec §1, §8, §9) through the real
 * modules, asserts every row is exactly the frame width, and prints the rows for eyeballing.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { highlightCode } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";

const repoRoot = process.cwd();
const workDir = join(repoRoot, ".pi", "geek-frame-smoke");
const buildDir = join(workDir, "build");
const homeDir = join(workDir, "home");
const tsc = join(repoRoot, "node_modules", "typescript", "lib", "tsc.js");

rmSync(workDir, { recursive: true, force: true });
mkdirSync(buildDir, { recursive: true });
mkdirSync(homeDir, { recursive: true });
process.env.HOME = homeDir;
process.env.USERPROFILE = homeDir;
writeFileSync(join(buildDir, "package.json"), '{"type":"module"}\n', "utf8");
const build = spawnSync(process.execPath, [
	tsc, "--target", "ES2022", "--module", "NodeNext", "--moduleResolution", "NodeNext",
	"--outDir", buildDir, "--rootDir", repoRoot, "--skipLibCheck", "--noImplicitAny", "false", "--lib", "ES2022",
	join(repoRoot, "editor", "geek-editor.ts"),
	join(repoRoot, "editor", "live-state.ts"),
	join(repoRoot, "startup-ui.ts"),
	join(repoRoot, "theme", "geek-theme.ts"),
], { cwd: repoRoot, encoding: "utf8" });
if (build.status !== 0) throw new Error(`tsc failed\n${build.stdout}\n${build.stderr}`);

const load = (path) => import(pathToFileURL(join(buildDir, path)).href);
const { GeekEditor } = await load("editor/geek-editor.js");
const { setLiveState } = await load("editor/live-state.js");
const { renderStartupHeader } = await load("startup-ui.js");
const { createGeekTheme } = await load("theme/geek-theme.js");

const strip = (text) => String(text).replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
const failures = [];
const expect = (name, condition) => { if (!condition) failures.push(name); };

const providers = {
	cwd: join(homeDir, "code", "kpi-api"),
	getContextUsage: () => ({ tokens: 62800, percent: 31.4, contextWindow: 200000 }),
	getModelInfo: () => ({ provider: "anthropic", id: "claude-opus-5-5", reasoning: true, thinkingLevel: "high" }),
	getBranch: () => ({ branch: "fix/refresh-ttl" }),
	getFooterStatus: () => null,
	getTokenUsage: () => ({ input: 41000, output: 6900, cacheRead: 212000, cacheWrite: 18000, cacheHitPercent: 82.4 }),
};
const editorTheme = { borderColor: (s) => s, selectList: { selectedPrefix: (s) => s, selectedText: (s) => s, description: (s) => s, scrollInfo: (s) => s, noMatch: (s) => s } };
const keybindings = { matches: () => false, getKeys: () => [] };
const tui = { requestRender() {}, terminal: { rows: 40, columns: 100 } };

const editor = new GeekEditor(tui, editorTheme, keybindings, providers);
editor.setText("run tests again then commit");
const info = { cwd: providers.cwd, getSessionName: () => "refresh-ttl", getTurnCount: () => 2 };

// Startup header (spec §1): one title-bar line, exact width, segments in order, narrow widths drop in order.
{
	const plain = (i, width) => { const rows = renderStartupHeader(i, width); return { rows, text: strip(rows[0]) }; };
	const full = plain(info, 120);
	expect("header is a single line", full.rows.length === 1);
	expect("header segments in order: π pi, cwd, session · turn", /^── π pi ─+ ~\/code\/kpi-api ─── refresh-ttl · turn 2 ──$/.test(full.text));
	for (const w of [120, 92, 60, 40, 30, 24, 16, 12]) expect(`header exactly ${w} cells`, visibleWidth(plain(info, w).rows[0]) === w && plain(info, w).rows.length === 1);
	const has = (w, part) => plain(info, w).text.includes(part);
	const needed = "── π pi ─ ~/code/kpi-api ─── refresh-ttl · turn 2 ──".length;
	expect("cwd is left-truncated with … before anything else drops", has(needed - 3, "…") && has(needed - 3, "refresh-ttl · turn 2"));
	expect("narrow: cwd gone, then turn, then session", !has(36, "kpi") && has(36, "turn 2") && !has(30, "turn") && has(30, "refresh-ttl") && !has(20, "refresh") && has(20, "π pi"));
	const unnamed = plain({ ...info, getSessionName: () => undefined }, 120).text;
	expect("no session name: right segment is just `turn N`", /─── turn 2 ──$/.test(unnamed) && !unnamed.includes("·"));
	expect("no turns yet: right segment is just the session", /─── refresh-ttl ──$/.test(plain({ ...info, getTurnCount: () => 0 }, 120).text));
}

for (const width of [60, 92, 120]) {
	setLiveState(undefined);
	for (const row of [...renderStartupHeader(info, width), ...editor.render(width)]) {
		expect(`idle row is exactly ${width} cells: ${strip(row)}`, visibleWidth(row) === width || row === "");
	}
	setLiveState("thinking");
	for (const row of editor.render(width)) {
		expect(`live row is exactly ${width} cells: ${strip(row)}`, visibleWidth(row) === width || row === "");
	}
	setLiveState(undefined);
}

const width = 92;
const idle = editor.render(width).map(strip);
expect("idle head row has no state word", !/thinking|working|answering|running/.test(idle[0]));
expect("head row carries user@project, path and branch (no time)", /^ {6}• \S+@kpi-api ~\/code\/kpi-api \(fix\/refresh-ttl\)/.test(idle[0]));
expect("input row is `› text` on a blank rail", /^ {8}› run tests again then commit/.test(idle[1]));
expect("footer has ctx and tok rows", idle.some((r) => /^\s+ctx\s+█+░+  31\.4%\/200k/.test(r)) && idle.some((r) => /^\s+tok\s+↑41k ↓6\.9k  R212k W18k  CH 82\.4%\s*$/.test(r)));
setLiveState("thinking");
editor.render(width); // starts the decode-in of the word; once it settled the plain word shows
const realNow = Date.now;
Date.now = () => realNow() + 1000;
expect("live head row shows state word and seconds", /thinking · \d+\.\ds$/.test(editor.render(width).map(strip)[0]));
Date.now = realNow;
setLiveState(undefined);

// Host highlighting (read/diff code rows) must come out in palette colors, not a host theme's.
globalThis[Symbol.for("@earendil-works/pi-coding-agent:theme")] = createGeekTheme();
const code = highlightCode("const exp = now + 1000; // ttl", "typescript")[0];
expect("highlightCode uses palette: kw, num, comment", code.includes("38;2;104;158;128mconst") && code.includes("38;2;216;120;91m1000") && code.includes("38;2;82;91;84m// ttl"));

console.log("--- startup header ---");
for (const row of renderStartupHeader(info, width)) console.log(row);
console.log("--- idle input zone + footer ---");
for (const row of editor.render(width)) console.log(row);
console.log("--- highlighted code row ---");
console.log(code);
setLiveState("thinking");
console.log("--- live ---");
console.log(editor.render(width)[0]);
setLiveState(undefined);

rmSync(workDir, { recursive: true, force: true });
if (failures.length) {
	console.error(`geek-frame smoke FAILED (${failures.length}):\n  - ${failures.join("\n  - ")}`);
	process.exit(1);
}
console.log("geek-frame smoke ok");
