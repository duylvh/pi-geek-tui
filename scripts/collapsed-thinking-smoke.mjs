#!/usr/bin/env node
/**
 * US-024 collapsed thinking tail smoke.
 *
 * Runs against the real Pi 0.78 core in node_modules (per-block layout) plus a grouped-layout
 * stub that mirrors the Pi 0.84+ single-child layout, so both host layouts are covered.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { buildSmoke } from "./smoke-build.mjs";

const repoRoot = process.cwd();
const workDir = join(repoRoot, ".pi", "collapsed-thinking-smoke");
const buildDir = join(workDir, "build");
const stubPath = join(workDir, "node-stubs.d.ts");
const tsc = join(repoRoot, "node_modules", "typescript", "lib", "tsc.js");
const home = join(workDir, "home");
const configPath = join(home, ".pi", "agent", "pi-geek-tui.json");

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

const failures = [];
function check(name, fn) {
	try {
		fn();
	} catch (error) {
		failures.push(`${name}: ${error?.message ?? error}`);
	}
}

const stripAnsi = (text) => String(text).replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "").replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
const rowWith = (rawLines, needle) => rawLines.find((line) => stripAnsi(line).includes(needle));
const graphemeSegments = (text) => Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text), (part) => part.segment);
const isGraphemeSuffix = (source, tail) => graphemeSegments(source).some((_, index) => graphemeSegments(source).slice(index).join("") === tail);

function prepareBuild() {
	buildSmoke("collapsed-thinking-smoke", [
		"config.ts",
		"messages/assistant-content-runs.ts",
		"messages/assistant-prefix.ts",
		"render-budget.ts",
		"performance/profiler.ts",
		"theme/geek-palette.ts",
		"theme/ansi.ts",
	]);
	mkdirSync(dirname(configPath), { recursive: true });
}

const CONFIG_MTIME_BASE = 1_700_000_000;
let configMtime = CONFIG_MTIME_BASE;

// Rows are checked on the first render of a live component; the reveal animation (scripts/reveal-smoke.mjs) is off here.
function writeConfig(config) {
	writeFileSync(configPath, `${JSON.stringify({ revealAnimation: false, ...config }, null, 2)}\n`, "utf8");
	configMtime += 2;
	utimesSync(configPath, configMtime, configMtime);
}

// ---- isolated HOME + controllable clock so loadConfig's 1s throttle cannot hide a rewrite ----
let fakeNow = 2_000_000;
Date.now = () => fakeNow;
function setConfig(config) {
	writeConfig(config);
	fakeNow += 5_000;
}

prepareBuild();
process.env.HOME = home;
writeConfig({ collapsedThinking: "tail" });

const budget = await import(pathToFileURL(join(buildDir, "render-budget.js")).href);
const runsModule = await import(pathToFileURL(join(buildDir, "messages", "assistant-content-runs.js")).href);
const prefixModule = await import(pathToFileURL(join(buildDir, "messages", "assistant-prefix.js")).href);
const configModule = await import(pathToFileURL(join(buildDir, "config.js")).href);
const streamingState = await import(pathToFileURL(join(buildDir, "messages", "assistant-streaming-state.js")).href);

const { initTheme, AssistantMessageComponent } = await import("@earendil-works/pi-coding-agent");
const { Markdown, Spacer } = await import("@earendil-works/pi-tui");
initTheme("dark");

prefixModule.installAssistantMessagePrefix();

// Liveness is captured when a component is patched, so a check marks the stream active around the
// updateContent call it wants to observe live. The tracked message object must be the same one fed
// to updateContent, mirroring Pi core passing the message_start/message_update event message through.
function withActiveStream(message, fn) {
	streamingState.beginAssistantStream(message);
	try {
		return fn();
	} finally {
		streamingState.endAssistantStream();
	}
}

// ---------------------------------------------------------------- grouped-layout stub (Pi 0.84+)
const isVisibleBlock = (block) => (block.type === "text" && block.text.trim()) || (block.type === "thinking" && block.thinking.trim());

class GroupedLayoutStub {
	constructor(message, hideThinkingBlock = true, hiddenThinkingLabel = "StubLabel", overrides) {
		this.hideThinkingBlock = hideThinkingBlock;
		this.hiddenThinkingLabel = hiddenThinkingLabel;
		this.thinkingVisibilityOverrides = overrides;
		this.contentContainer = { children: [] };
		if (message) this.updateContent(message);
	}
	// mirrors Pi >= 0.84: consecutive thinking blocks collapse into a single child
	updateContent(message) {
		const children = [];
		if (message.content.some(isVisibleBlock)) children.push(new Spacer(1));
		for (let i = 0; i < message.content.length; i++) {
			const block = message.content[i];
			if (block.type === "text" && block.text.trim()) {
				children.push(new Markdown(block.text.trim(), 1, 0));
				continue;
			}
			if (block.type !== "thinking") continue;
			const thinkingBlocks = [];
			for (; i < message.content.length && message.content[i].type === "thinking"; i++) {
				if (message.content[i].thinking.trim()) thinkingBlocks.push(message.content[i].thinking.trim());
			}
			i--;
			if (thinkingBlocks.length === 0) continue;
			children.push(new Markdown(thinkingBlocks.join("\n\n"), 1, 0));
			if (message.content.slice(i + 1).some(isVisibleBlock)) children.push(new Spacer(1));
		}
		this.contentContainer.children = children;
	}
}

prefixModule.installAssistantMessagePrefix(undefined, GroupedLayoutStub);

function groupedThinkingChild(message, options = {}) {
	const component = new GroupedLayoutStub(message, options.hideThinkingBlock ?? true, options.label ?? "Thinking...", options.overrides);
	const runs = runsModule.getAssistantContentRuns(component, message);
	return { component, runs, childAt: (index) => component.contentContainer.children[runs[index].childIndex] };
}

// ---------------------------------------------------------------- fixtures 
const LONG_ASCII = Array.from({ length: 300 }, (_, index) => String.fromCharCode(97 + (index % 26))).join("");
const CJK_LINE = "思考のながれ".repeat(24);
const EMOJI_LINE = "🙂🚀".repeat(80);

const FIXTURES = [
	{ name: "thinking-only", content: [{ type: "thinking", thinking: "alpha" }] },
	{ name: "thinking-final", content: [{ type: "thinking", thinking: "alpha" }, { type: "text", text: "FINALANSWER" }] },
	{ name: "two-thoughts-final", content: [{ type: "thinking", thinking: "alpha" }, { type: "thinking", thinking: "beta" }, { type: "text", text: "FINALANSWER" }] },
	{ name: "three-thoughts-final", content: [{ type: "thinking", thinking: "alpha" }, { type: "thinking", thinking: "beta" }, { type: "thinking", thinking: "gamma" }, { type: "text", text: "FINALANSWER" }] },
	{ name: "thinking-toolcall", content: [{ type: "thinking", thinking: "alpha" }, { type: "toolCall", id: "1", name: "read", arguments: {} }] },
	{ name: "split-runs", content: [{ type: "thinking", thinking: "firstthought" }, { type: "text", text: "MIDANSWER" }, { type: "thinking", thinking: "secondthought" }, { type: "text", text: "FINALANSWER" }] },
	{ name: "text-only", content: [{ type: "text", text: "just an answer" }] },
];

function renderFixture(fixture, hideThinking, width) {
	return new AssistantMessageComponent({ role: "assistant", content: fixture.content }, hideThinking).render(width);
}



// ---------------------------------------------------------------- P1..P11 + config cases
const LIVE_TAIL = "nên child index phải đi theo rendered run, không phải raw block";
// Real pi-ai shape: every streaming partial already carries stopReason "stop" from the first delta.
const hiddenOnly = (thinking, stopReason = "stop") => ({ role: "assistant", content: [{ type: "thinking", thinking }], stopReason });
const liveMessage = hiddenOnly(LIVE_TAIL);

check("P1 real core (0.78 per-block) live tail", () => {
	const message = hiddenOnly(LIVE_TAIL);
	const raw = withActiveStream(message, () => new AssistantMessageComponent(message, true).render(120));
	const row = rowWith(raw, "thinking");
	assert(row !== undefined, `collapsed row missing: ${JSON.stringify(raw.map(stripAnsi))}`);
	assert(stripAnsi(row).includes("▸"), `live marker missing: ${JSON.stringify(stripAnsi(row))}`);
	assert(stripAnsi(row).includes(LIVE_TAIL), `whole tail line should fit at width 120: ${JSON.stringify(stripAnsi(row))}`);
});

check("P1 grouped layout live tail (1/2/3 blocks)", () => {
	for (const thoughts of [["a"], ["alpha", "beta"], ["alpha", "beta", "gamma"]]) {
		const message = { role: "assistant", stopReason: "stop", content: thoughts.map((thinking) => ({ type: "thinking", thinking })) };
		const { childAt } = withActiveStream(message, () => groupedThinkingChild(message, { label: "Thinking..." }));
		const plain = childAt(0).render(60).map(stripAnsi).join("\n");
		assert(plain.includes("thinking ▸"), `grouped ${thoughts.length}: trimmed label missing: ${plain}`);
		assert(plain.includes("▸"), `grouped ${thoughts.length}: live marker missing: ${plain}`);
		assert(plain.includes(`▸ ${thoughts[thoughts.length - 1]}`), `grouped ${thoughts.length}: tail should come from the last block: ${plain}`);
	}
});

check("P2a settled after the stream ends", () => {
	for (const stopReason of ["stop", "aborted", "error"]) {
		const partial = hiddenOnly(LIVE_TAIL);
		const component = withActiveStream(partial, () => new AssistantMessageComponent(partial, true));
		assert(stripAnsi(rowWith(component.render(120), "thinking")).includes("▸"), `${stopReason}: partial should start live`);
		component.updateContent({ ...partial, stopReason });
		const row = stripAnsi(rowWith(component.render(120), "thinking"));
		assert(row.includes("·") && !row.includes("▸"), `${stopReason}: settled marker missing: ${JSON.stringify(row)}`);
		assert(row.includes(LIVE_TAIL), `${stopReason}: tail missing`);
	}
});

check("P2b stopReason is not the liveness signal", () => {
	const component = new AssistantMessageComponent({ role: "assistant", content: [{ type: "thinking", thinking: LIVE_TAIL }] }, true);
	const row = stripAnsi(rowWith(component.render(120), "thinking"));
	assert(row.includes("·") && !row.includes("▸"), `undefined stopReason with no stream must be settled: ${JSON.stringify(row)}`);
});

check("P2c begin live -> end settled on one component", () => {
	const partial = hiddenOnly("alpha");
	const component = new AssistantMessageComponent(undefined, true);
	streamingState.beginAssistantStream(partial);
	component.updateContent(partial);
	assert(stripAnsi(rowWith(component.render(120), "thinking")).includes("▸"), "live while the stream is active");
	streamingState.endAssistantStream();
	component.updateContent(hiddenOnly("alpha"));
	assert(stripAnsi(rowWith(component.render(120), "thinking")).includes("·"), "settled once the stream ends");
});

check("P2d an older component does not adopt a newer stream", () => {
	const first = hiddenOnly("alpha");
	const older = withActiveStream(first, () => new AssistantMessageComponent(first, true));
	assert(stripAnsi(rowWith(older.render(120), "thinking")).includes("▸"), "older component is live in its own stream");
	const newerMessage = hiddenOnly("beta");
	withActiveStream(newerMessage, () => {
		const newer = new AssistantMessageComponent(newerMessage, true);
		assert(stripAnsi(rowWith(newer.render(120), "thinking")).includes("▸"), "newer component is live in the new stream");
		older.updateContent(older.lastMessage);
		const row = stripAnsi(rowWith(older.render(120), "thinking"));
		assert(row.includes("·") && !row.includes("▸"), `older component must stay settled during a newer stream: ${JSON.stringify(row)}`);
	});
});

check("P2e a history component rebuilt mid-stream stays settled", () => {
	const streamMessage = hiddenOnly("streaming-thought");
	const historyMessage = hiddenOnly("history-thought");
	withActiveStream(streamMessage, () => {
		const history = new AssistantMessageComponent(historyMessage, true);
		const row = stripAnsi(rowWith(history.render(120), "thinking"));
		assert(row.includes("·") && !row.includes("▸"), `history component must stay settled: ${JSON.stringify(row)}`);
	});
});

check("P2f the streaming component tolerates a clone of the tracked message", () => {
	const tracked = hiddenOnly("alpha");
	streamingState.beginAssistantStream(tracked);
	try {
		const fresh = new AssistantMessageComponent(tracked, true);
		assert(stripAnsi(rowWith(fresh.render(120), "thinking")).includes("▸"), "streaming component is live");
		fresh.updateContent({ ...tracked, content: [{ type: "thinking", thinking: "alpha beta" }] });
		assert(stripAnsi(rowWith(fresh.render(120), "thinking")).includes("▸"), "a structural clone must still read the tag made from the tracked message");
	} finally {
		streamingState.endAssistantStream();
	}
});

check("P2g a new stream does not revive the previous component", () => {
	const first = hiddenOnly("alpha");
	const component = withActiveStream(first, () => new AssistantMessageComponent(first, true));
	assert(stripAnsi(rowWith(component.render(120), "thinking")).includes("▸"), "component is live in its own stream");
	withActiveStream(hiddenOnly("beta"), () => {
		component.updateContent(component.lastMessage);
		const row = stripAnsi(rowWith(component.render(120), "thinking"));
		assert(row.includes("·") && !row.includes("▸"), `previous component must stay settled: ${JSON.stringify(row)}`);
	});
});

check("P3 answer/tool-call follows settles the row", () => {
	for (const follower of [{ type: "text", text: "streaming answer" }, { type: "toolCall", id: "1", name: "read", arguments: {} }]) {
		const message = { role: "assistant", stopReason: "stop", content: [{ type: "thinking", thinking: "alpha" }, follower] };
		const raw = withActiveStream(message, () => new AssistantMessageComponent(message, true).render(60));
		const row = stripAnsi(rowWith(raw, "thinking"));
		assert(row.includes("·") && !row.includes("▸"), `follower ${follower.type}: thinking row should be settled: ${JSON.stringify(row)}`);
	}
});

check("P4 truncation is left-anchored and monotonic", () => {
	let previousTailLength = -1;
	for (const width of [40, 80, 160]) {
		const message = hiddenOnly(LONG_ASCII);
		const raw = withActiveStream(message, () => new AssistantMessageComponent(message, true).render(width));
		const row = stripAnsi(rowWith(raw, "thinking")).trimEnd();
		assert(row.includes("…"), `width ${width}: truncated tail should start with an ellipsis: ${JSON.stringify(row)}`);
		const tail = row.slice(row.indexOf("…") + 1);
		assert(LONG_ASCII.endsWith(tail), `width ${width}: tail must be the end of the line: ${JSON.stringify(tail.slice(0, 12))}`);
		assert(budget.safeVisibleWidth(row.trimEnd()) <= width, `width ${width}: row overflows`);
		assert(tail.length >= previousTailLength, `width ${width}: widening must not show fewer trailing characters`);
		previousTailLength = tail.length;
	}
});

check("P4 wide graphemes are dropped whole", () => {
	for (const source of [CJK_LINE, EMOJI_LINE]) {
		for (const width of [40, 80, 161]) {
			const message = hiddenOnly(source);
			const raw = withActiveStream(message, () => new AssistantMessageComponent(message, true).render(width));
			const row = stripAnsi(rowWith(raw, "thinking")).trimEnd();
			const tail = row.slice(row.indexOf("…") + 1);
			assert(isGraphemeSuffix(source, tail), `width ${width}: tail split a grapheme: ${JSON.stringify(tail.slice(0, 6))}`);
			assert(budget.safeVisibleWidth(row) <= width, `width ${width}: wide grapheme row overflows`);
		}
	}
});

check("P4 whitespace right after the ellipsis is trimmed", () => {
	// At width 41 (body 37, label "thinking" = 8) the tail budget is 25 → the last 24 columns are kept;
	// 23 y's plus the space before them land the cut exactly on that space.
	const text = `${"z".repeat(50)} ${"y".repeat(23)}`;
	const message = hiddenOnly(text);
	const raw = withActiveStream(message, () => new AssistantMessageComponent(message, true).render(41));
	const row = stripAnsi(rowWith(raw, "thinking")).trimEnd();
	const tail = row.slice(row.indexOf("…") + 1);
	assert(tail === "y".repeat(23), `cut on whitespace must drop the space after the ellipsis: ${JSON.stringify(tail)}`);
});

check("P8 label from hiddenThinkingLabel (trailing progress dots trimmed) + no hardcoded label", () => {
	const label = "reasoning…";
	const raw = withActiveStream(liveMessage, () => new AssistantMessageComponent(liveMessage, true, undefined, label).render(60));
	const row = rowWith(raw, "reasoning");
	assert(row !== undefined, "component.hiddenThinkingLabel must be the label source");
	assert(stripAnsi(row).includes("reasoning ▸"), `trailing dots must be trimmed so the marker carries the state: ${JSON.stringify(stripAnsi(row))}`);
	assert(!stripAnsi(row).includes("reasoning…"), "label's own ellipsis must not survive in tail mode");
	assert(!raw.some((line) => stripAnsi(line).includes("thinking")), "module must not fall back to a hardcoded label");
	const source = readFileSync(join(repoRoot, "messages", "assistant-prefix.ts"), "utf8");
	assert(!source.includes("Thinking..."), "assistant-prefix.ts must not contain the literal label");
});

check("P7 visibility overrides (0.85) + no-map fallthrough (0.78)", () => {
	const message = {
		role: "assistant",
		stopReason: "stop",
		content: [
			{ type: "thinking", thinking: "visible-thought" },
			{ type: "text", text: "MIDANSWER" },
			{ type: "thinking", thinking: "hidden-thought" },
		],
	};
	const overridden = withActiveStream(message, () => groupedThinkingChild(message, { label: "Thinking...", overrides: new Map([[0, false]]) }));
	const visibleRow = stripAnsi(overridden.childAt(0).render(60).join("\n"));
	const hiddenRow = stripAnsi(overridden.childAt(2).render(60).join("\n"));
	assert(visibleRow.includes("visible-thought") && !visibleRow.includes("thinking"), `override run 0 should use the visible path: ${visibleRow}`);
	assert(hiddenRow.includes("thinking ▸") && hiddenRow.includes("hidden-thought"), `override run 1 should use the tail row: ${hiddenRow}`);

	const noMap = withActiveStream(message, () => groupedThinkingChild(message, { label: "Thinking..." }));
	// run 0 is followed by text, so its collapsed row is settled (·) even while the stream is live
	assert(stripAnsi(noMap.childAt(0).render(60).join("\n")).includes("thinking ·"), "a host with no override map must collapse every run");
});

check("P9 updateContent is the only source", () => {
	const first = hiddenOnly("alpha\nbeta");
	streamingState.beginAssistantStream(first);
	try {
		const component = new AssistantMessageComponent(first, true);
		assert(stripAnsi(rowWith(component.render(120), "thinking")).includes("▸ beta"), "first update should tail beta");
		component.updateContent(hiddenOnly("alpha\nbeta gamma"));
		assert(stripAnsi(rowWith(component.render(120), "thinking")).includes("▸ beta gamma"), "second update should advance the tail");
		const before = component.render(120);
		assert(JSON.stringify(before) === JSON.stringify(component.render(120)), "rendering twice without an update must be stable");
	} finally {
		streamingState.endAssistantStream();
	}
	const source = readFileSync(join(repoRoot, "messages", "assistant-prefix.ts"), "utf8");
	assert(!source.includes("setTimeout") && !source.includes("addListener"), "the row must not add event or timer sources");
});

check("P11 interleaved runs settle independently", () => {
	// thinking -> text -> thinking: the first run is followed by text so it settled; the trailing run is live.
	const live = {
		role: "assistant",
		stopReason: "stop",
		content: [
			{ type: "thinking", thinking: "firstthought" },
			{ type: "text", text: "MIDANSWER" },
			{ type: "thinking", thinking: "secondthought" },
		],
	};
	const raw = withActiveStream(live, () => new AssistantMessageComponent(live, true).render(80));
	const first = stripAnsi(raw.find((line) => stripAnsi(line).includes("firstthought")));
	const second = stripAnsi(raw.find((line) => stripAnsi(line).includes("secondthought")));
	assert(first.includes("·") && !first.includes("▸"), `first run should be settled: ${JSON.stringify(first)}`);
	assert(second.includes("▸"), `the trailing run has nothing after it, so it stays live: ${JSON.stringify(second)}`);
	assert(raw.every((line) => stripAnsi(line).includes("┊") || stripAnsi(line).includes("•")), "every row stays on the rail");
});

check("P5 narrow widths fall back to the label row", () => {
		// label "thinking" = 8 cols → the tail needs body ≥ 28, i.e. width ≥ 32; everything below is label-only.
	for (const width of [20, 26, 28, 30]) {
		setConfig({ collapsedThinking: "label" });
		const label = renderFixture({ name: "n", content: [{ type: "thinking", thinking: "alpha" }] }, true, width);
		setConfig({ collapsedThinking: "tail" });
		const tail = renderFixture({ name: "n", content: [{ type: "thinking", thinking: "alpha" }] }, true, width);
		assert(JSON.stringify(label) === JSON.stringify(tail), `width ${width}: narrow tail row must equal the label row`);
	}
	setConfig({ collapsedThinking: "tail" });
});

check("safeTakeTailToWidth unit behaviour", () => {
	assert(budget.safeTakeTailToWidth("abcdef", 10) === "abcdef", "short text should pass through");
	assert(budget.safeTakeTailToWidth("abcdefgh", 4) === "…fgh", "long text should keep the last columns with an ellipsis");
	assert(budget.safeTakeTailToWidth("abcdefgh", 1) === "…", "width 1 should leave the ellipsis only");
	assert(budget.safeTakeTailToWidth("abcdefgh", 0) === "", "width 0 should be empty");
	assert(budget.safeTakeTailToWidth("あいうえお", 4) === "…お", "wide text should not split a grapheme");
	assert(budget.safeVisibleWidth(budget.safeTakeTailToWidth("あいうえお", 4)) <= 4, "wide tail must stay within budget");
});

// ---------------------------------------------------------------- config scaffold/normalise cases
async function loadConfigCase(name, initialConfig) {
	const caseHome = join(workDir, `config-${name}`);
	const casePath = join(caseHome, ".pi", "agent", "pi-geek-tui.json");
	mkdirSync(dirname(casePath), { recursive: true });
	if (initialConfig !== undefined) writeFileSync(casePath, `${JSON.stringify(initialConfig)}\n`, "utf8");
	process.env.HOME = caseHome;
	const moduleUrl = `${pathToFileURL(join(buildDir, "config.js")).href}?case=${name}`;
	const { loadConfig } = await import(moduleUrl);
	const config = loadConfig();
	assert(existsSync(casePath), `${name}: config file was not scaffolded`);
	return { config, raw: JSON.parse(readFileSync(casePath, "utf8")) };
}

const scaffoldedCase = await loadConfigCase("scaffold", undefined);
check("config scaffold default is tail", () => {
	assert(scaffoldedCase.config.collapsedThinking === "tail", "new config should default collapsedThinking to tail");
	assert(scaffoldedCase.raw.collapsedThinking === "tail", "scaffolded file should include collapsedThinking");
});

const labelCase = await loadConfigCase("label", { collapsedThinking: "label" });
check("config label is preserved", () => {
	assert(labelCase.config.collapsedThinking === "label", "explicit label must be preserved");
});

const invalidCase = await loadConfigCase("invalid", { collapsedThinking: "neon" });
check("config invalid normalises to tail", () => {
	assert(invalidCase.config.collapsedThinking === "tail", "invalid collapsedThinking must normalise to tail");
	assert(invalidCase.raw.collapsedThinking === "tail", "invalid collapsedThinking must be backfilled on disk");
});

const missingCase = await loadConfigCase("missing", { presentationStyle: "droid" });
check("config missing key is backfilled", () => {
	assert(missingCase.config.collapsedThinking === "tail", "missing collapsedThinking must default to tail");
	assert(missingCase.raw.collapsedThinking === "tail", "missing collapsedThinking must be backfilled on disk");
});

process.env.HOME = home;

if (failures.length > 0) {
	console.error(`collapsed thinking smoke FAILED (${failures.length}):`);
	for (const failure of failures) console.error(`  - ${failure}`);
	process.exit(1);
}
console.log("collapsed thinking smoke ok");
