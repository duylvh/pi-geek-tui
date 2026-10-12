#!/usr/bin/env node
/**
 * Frame smoke: renders the startup header, input zone and footer (spec §1, §8, §9) through the real
 * modules, asserts every row is exactly the frame width, and prints the rows for eyeballing.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
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
], { cwd: repoRoot, encoding: "utf8" });
if (build.status !== 0) throw new Error(`tsc failed\n${build.stdout}\n${build.stderr}`);

const load = (path) => import(pathToFileURL(join(buildDir, path)).href);
const { GeekEditor } = await load("editor/geek-editor.js");
const { setLiveState } = await load("editor/live-state.js");
const { renderStartupHeader } = await load("startup-ui.js");

const strip = (text) => String(text).replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
const failures = [];
const expect = (name, condition) => { if (!condition) failures.push(name); };

const providers = {
	cwd: join(homeDir, "code", "kpi-api"),
	getContextUsage: () => ({ tokens: 62800, percent: 31.4, contextWindow: 200000 }),
	getModelInfo: () => ({ provider: "anthropic", id: "claude-opus-5-5", reasoning: true, thinkingLevel: "high" }),
	getBranch: () => ({ branch: "fix/refresh-ttl" }),
	getFooterStatus: () => null,
	getTokenUsage: () => ({ input: 41000, output: 6900, cacheRead: 212000, cacheWrite: 18000, cacheHitPercent: 82.4, cost: 0.412 }),
};
const editorTheme = { borderColor: (s) => s, selectList: { selectedPrefix: (s) => s, selectedText: (s) => s, description: (s) => s, scrollInfo: (s) => s, noMatch: (s) => s } };
const keybindings = { matches: () => false, getKeys: () => [] };
const tui = { requestRender() {}, terminal: { rows: 40, columns: 100 } };

const editor = new GeekEditor(tui, editorTheme, keybindings, providers);
editor.setText("run tests again then commit");
const info = { cwd: providers.cwd, getSessionName: () => "refresh-ttl", getTurnCount: () => 2 };

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
expect("idle head row has no state word", !/thinking|working|answering|running/.test(idle[1]));
expect("head row carries time, user, path and branch", /^\s*\d\d:\d\d • \S+@\S+ ~\/code\/kpi-api \(fix\/refresh-ttl\)/.test(idle[1]));
expect("input row is `› text` on a blank rail", /^ {8}› run tests again then commit/.test(idle[2]));
expect("footer has ctx and tok rows", idle.some((r) => /^\s+ctx\s+█+░+  31\.4%\/200k/.test(r)) && idle.some((r) => /^\s+tok\s+↑41k ↓6\.9k  R212k W18k  CH 82\.4%.*\$0\.412$/.test(r)));
setLiveState("thinking");
expect("live head row shows state word and seconds", /thinking · \d+\.\ds$/.test(editor.render(width).map(strip)[1]));
setLiveState(undefined);

console.log("--- startup header ---");
for (const row of renderStartupHeader(info, width)) console.log(row);
console.log("--- idle input zone + footer ---");
for (const row of editor.render(width)) console.log(row);
setLiveState("thinking");
console.log("--- live ---");
console.log(editor.render(width)[1]);
setLiveState(undefined);

rmSync(workDir, { recursive: true, force: true });
if (failures.length) {
	console.error(`geek-frame smoke FAILED (${failures.length}):\n  - ${failures.join("\n  - ")}`);
	process.exit(1);
}
console.log("geek-frame smoke ok");
