#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = process.cwd();
const workDir = join(repoRoot, ".pi", "working-message-smoke");
const buildDir = join(workDir, "build");
const stubPath = join(workDir, "node-stubs.d.ts");
const tsc = join(repoRoot, "node_modules", "typescript", "lib", "tsc.js");
let importCounter = 0;

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

function prepareWorkDir() {
	rmSync(workDir, { recursive: true, force: true });
	mkdirSync(buildDir, { recursive: true });
	writeFileSync(join(buildDir, "package.json"), "{\"type\":\"module\"}\n", "utf8");
	writeFileSync(stubPath, `declare module "fs" {
	export const existsSync: (path: string) => boolean;
	export const mkdirSync: (path: string, options?: unknown) => unknown;
	export const readFileSync: (path: string, encoding?: string) => any;
	export const renameSync: (from: string, to: string) => void;
	export const unlinkSync: (path: string) => void;
	export const statSync: (path: string) => { mtimeMs: number; size: number };
	export const writeFileSync: (path: string, data: string, encoding?: string) => void;
}
declare module "path" {
	export const dirname: (path: string) => string;
	export const join: (...parts: string[]) => string;
}
declare module "os" {
	export const homedir: () => string;
}
`, "utf8");
}

function compileChangedSurface() {
	if (!existsSync(tsc)) throw new Error("typescript is not installed; run npm install before npm run test:working-message");
	const result = spawnSync(process.execPath, [
		tsc,
		"--outDir", buildDir,
		"--rootDir", repoRoot,
		"--module", "NodeNext",
		"--moduleResolution", "NodeNext",
		"--target", "ES2022",
		"--skipLibCheck",
		"--noImplicitAny", "false",
		stubPath,
		"config.ts",
		"editor/live-state.ts",
		"index.ts",
	], { cwd: repoRoot, encoding: "utf8" });
	if (result.status !== 0) {
		process.stderr.write(result.stdout || "");
		process.stderr.write(result.stderr || "");
		throw new Error(`TypeScript compile failed with code ${result.status}`);
	}
	console.log("tsc focused ok");
}

async function importBuilt(relativePath) {
	importCounter += 1;
	return import(`${pathToFileURL(join(buildDir, relativePath)).href}?smoke=${importCounter}`);
}

function writeInitialConfig(homeDir, initialJson) {
	if (initialJson === undefined) return;
	const configDir = join(homeDir, ".pi", "agent");
	mkdirSync(configDir, { recursive: true });
	writeFileSync(join(configDir, "pi-geek-tui.json"), `${initialJson}\n`, "utf8");
}

async function runConfigSmoke(name, initialJson, validate) {
	const homeDir = join(workDir, `home-${name.replace(/[^a-z0-9]+/gi, "-")}`);
	mkdirSync(homeDir, { recursive: true });
	writeInitialConfig(homeDir, initialJson);
	process.env.HOME = homeDir;
	process.env.USERPROFILE = homeDir;
	const { loadConfig } = await importBuilt("config.js");
	const config = loadConfig();
	const raw = JSON.parse(readFileSync(join(homeDir, ".pi", "agent", "pi-geek-tui.json"), "utf8"));
	validate({ config, raw });
	console.log(`config smoke ok: ${name}`);
}

async function runLiveStateSmoke() {
	const { workingStateForAssistantMessage } = await importBuilt("editor/live-state.js");
	const msg = (...content) => ({ content });
	assert(workingStateForAssistantMessage(msg()) === "thinking", "empty assistant message should be thinking");
	assert(workingStateForAssistantMessage(msg({ type: "text", text: "hi" })) === "answering", "answer text should be answering");
	assert(workingStateForAssistantMessage(msg({ type: "text", text: "hi" }, { type: "toolCall" })) === "running", "a tool call should win over text");
	console.log("live state smoke ok");
}

prepareWorkDir();
compileChangedSurface();

await runConfigSmoke("scaffold default object", undefined, ({ config, raw }) => {
	assert(raw.customWorkingMessage?.running === "running", "scaffold did not write default labels");
	assert(config.customWorkingMessage.thinking === "thinking", "default config missing thinking label");
});

await runConfigSmoke("legacy true transforms", '{"customWorkingMessage":true}', ({ config, raw }) => {
	assert(raw.customWorkingMessage?.running === "running", "legacy true was not backfilled to labels");
	assert(config.customWorkingMessage.working === "working", "legacy true did not normalize to labels");
});

await runConfigSmoke("legacy false transforms", '{"customWorkingMessage":false}', ({ config, raw }) => {
	assert(raw.customWorkingMessage?.running === "running", "legacy false was not backfilled to labels");
	assert(config.customWorkingMessage.answering === "answering", "legacy false did not normalize to labels");
});

await runConfigSmoke("partial custom labels backfilled", '{"customWorkingMessage":{"running":"Executing","thinking":"Pondering"}}', ({ config, raw }) => {
	assert(raw.customWorkingMessage?.running === "Executing", "custom running label was not preserved");
	assert(raw.customWorkingMessage?.working === "working", "missing default label was not backfilled");
	assert(config.customWorkingMessage.thinking === "Pondering", "custom thinking label did not normalize");
});

await runConfigSmoke("accent scaffold default", undefined, ({ config, raw }) => {
	assert(raw.accent === "#dd5670", "scaffold did not write default accent");
	assert(config.accent === "#dd5670", "default config missing accent");
	assert(!("inputBox" in raw) && !("presentationStyle" in raw) && !("userZoneStyle" in raw), "removed preset keys must not be scaffolded");
});

await runConfigSmoke("accent custom hex normalized", '{"accent":"#D85"}', ({ config, raw }) => {
	assert(config.accent === "#dd8855", "short/upper hex should normalize to #rrggbb");
	assert(raw.accent === "#dd8855", "normalized accent should be written back");
});

await runConfigSmoke("accent invalid fallback", '{"accent":"red","inputBox":{"style":"line"}}', ({ config, raw }) => {
	assert(raw.accent === "#dd5670" && config.accent === "#dd5670", "invalid accent should fall back to default");
	assert(!("inputBox" in raw), "removed inputBox key should be dropped from the file");
});

// A config that breaks after a good load keeps the last good values and is never touched;
// a missing file is still scaffolded.
async function runBrokenConfigSmoke() {
	const homeDir = join(workDir, "home-broken-config");
	const configDir = join(homeDir, ".pi", "agent");
	const configPath = join(configDir, "pi-geek-tui.json");
	const writeAt = (json, offsetMs) => {
		writeFileSync(configPath, json, "utf8");
		const when = new Date(Date.now() + offsetMs);
		utimesSync(configPath, when, when);
	};
	writeInitialConfig(homeDir, '{"accent":"#d8785b"}');
	process.env.HOME = homeDir;
	process.env.USERPROFILE = homeDir;
	const { loadConfig, getConfigIssue } = await importBuilt("config.js");
	assert(loadConfig().accent === "#d8785b" && getConfigIssue() === undefined, "valid config should load without an issue");

	// loadConfig re-stats at most once per second: move the clock instead of sleeping.
	const realNow = Date.now;
	let clock = realNow();
	Date.now = () => clock;
	try {
		const broken = '{"accent":"#88c6a3",}\n';
		writeAt(broken, 5000);
		clock += 2000;
		assert(loadConfig().accent === "#d8785b", "broken edit should keep the last good config, not defaults");
		assert(getConfigIssue()?.includes(configPath), "config issue should name the file");
		assert(readFileSync(configPath, "utf8") === broken, "broken config must not be rewritten");
		assert(readdirSync(configDir).join() === "pi-geek-tui.json", "broken config must not be renamed or shadowed");

		writeAt('{"accent":"#88c6a3"}', 10000);
		clock += 2000;
		assert(loadConfig().accent === "#88c6a3" && getConfigIssue() === undefined, "fixed config should load and clear the issue");
	} finally {
		Date.now = realNow;
	}

	const freshHome = join(workDir, "home-missing-config");
	mkdirSync(freshHome, { recursive: true });
	process.env.HOME = freshHome;
	process.env.USERPROFILE = freshHome;
	const fresh = await importBuilt("config.js");
	assert(fresh.loadConfig().accent === "#dd5670" && fresh.getConfigIssue() === undefined, "missing config should serve defaults without an issue");
	assert(existsSync(join(freshHome, ".pi", "agent", "pi-geek-tui.json")), "missing config should be scaffolded");
	console.log("config smoke ok: broken json keeps last good config");
}

await runBrokenConfigSmoke();

await runLiveStateSmoke();
console.log("working-message config smoke ok");
