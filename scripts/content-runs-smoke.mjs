#!/usr/bin/env node
/**
 * Assistant content-run mapping: Pi core renders consecutive thinking blocks as one child on newer
 * cores, so child lookups must follow rendered runs on both host layouts. Also pins that the
 * streaming markdown cache seeds each run's own child and that probing a patched host cannot recurse.
 */
import { rmSync } from "node:fs";
import { buildSmoke } from "./smoke-build.mjs";

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

const stripAnsi = (text) => String(text).replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "").replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");

const built = buildSmoke("content-runs-smoke", ["messages/assistant-prefix.ts", "messages/assistant-content-runs.ts", "messages/streaming-markdown-cache.ts"]);
const importBuilt = built.importFresh;
const { initTheme, AssistantMessageComponent } = await import("@earendil-works/pi-coding-agent");
initTheme("dark");
(await importBuilt("messages/assistant-prefix.js")).installAssistantMessagePrefix();

// Issue #20: Pi core renders consecutive thinking blocks as one child, so every child lookup
// must address rendered runs. These cases must hold on any Pi core in the supported peer range.
const isItalic = (line) => typeof line === "string" && line.includes("\x1b[3m");
const rowWith = (rawLines, needle) => rawLines.find((line) => stripAnsi(line).includes(needle));

for (const thoughts of [["alpha"], ["alpha", "beta"], ["alpha", "beta", "gamma"]]) {
	for (const hideThinking of [false, true]) {
		const label = `${thoughts.length} thinking + final (hideThinking=${hideThinking})`;
		const content = [...thoughts.map((thinking) => ({ type: "thinking", thinking })), { type: "text", text: "FINALANSWER" }];
		const raw = new AssistantMessageComponent({ role: "assistant", content }, hideThinking).render(46);
		const finalRow = rowWith(raw, "FINALANSWER");
		assert(finalRow !== undefined, `${label}: final response row should render`);
		assert(!isItalic(finalRow), `${label}: final response must not inherit thinking italics`);
		assert(stripAnsi(finalRow).indexOf("FINALANSWER") === 8, `${label}: final response should sit right after the 8-cell gutter+rail`);
		if (hideThinking) {
			// The collapsed row is `Thinking ▸/· …tail`; it must be the thinking child, not the answer.
			const hiddenRow = rowWith(raw, "Thinking");
			assert(hiddenRow !== undefined && !isItalic(hiddenRow), `${label}: hidden thinking row should render upright`);
		} else {
			for (const thought of thoughts) {
				assert(isItalic(rowWith(raw, thought)), `${label}: thinking "${thought}" should stay italic`);
			}
		}
	}
}

const splitRunsRaw = new AssistantMessageComponent({
	role: "assistant",
	content: [
		{ type: "thinking", thinking: "firstthought" },
		{ type: "text", text: "MIDANSWER" },
		{ type: "thinking", thinking: "secondthought" },
		{ type: "text", text: "FINALANSWER" },
	],
}).render(46);
assert(isItalic(rowWith(splitRunsRaw, "firstthought")) && isItalic(rowWith(splitRunsRaw, "secondthought")), "thinking runs split by text should each stay italic");
assert(!isItalic(rowWith(splitRunsRaw, "MIDANSWER")) && !isItalic(rowWith(splitRunsRaw, "FINALANSWER")), "text runs between thinking runs should stay normal assistant text");

const toolCallOnly = new AssistantMessageComponent({
	role: "assistant",
	content: [{ type: "toolCall", id: "1", name: "read", arguments: {} }],
}).render(46);
assert(toolCallOnly.every((line) => !stripAnsi(line).includes("│")), "tool-call-only assistant message renders no body rows (at most the turn head)");

// The installed core cannot exercise both layouts, so drive the shared mapper with stub
// components that reproduce each core's contentContainer layout exactly.
const { Markdown: TuiMarkdown, Spacer: TuiSpacer } = await import("@earendil-works/pi-tui");
const isVisibleBlock = (block) => (block.type === "text" && block.text.trim()) || (block.type === "thinking" && block.thinking.trim());

class GroupedLayoutStub {
	static constructions = 0;
	constructor(message) {
		GroupedLayoutStub.constructions += 1;
		this.contentContainer = { children: [] };
		if (message) this.updateContent(message);
	}
	// mirrors Pi >= 0.84: consecutive thinking blocks collapse into a single child
	updateContent(message) {
		const children = [];
		if (message.content.some(isVisibleBlock)) children.push(new TuiSpacer(1));
		for (let i = 0; i < message.content.length; i++) {
			const block = message.content[i];
			if (block.type === "text" && block.text.trim()) {
				children.push(new TuiMarkdown(block.text.trim(), 1, 0));
				continue;
			}
			if (block.type !== "thinking") continue;
			const thinkingBlocks = [];
			for (; i < message.content.length && message.content[i].type === "thinking"; i++) {
				if (message.content[i].thinking.trim()) thinkingBlocks.push(message.content[i].thinking.trim());
			}
			i--;
			if (thinkingBlocks.length === 0) continue;
			children.push(new TuiMarkdown(thinkingBlocks.join("\n\n"), 1, 0));
			if (message.content.slice(i + 1).some(isVisibleBlock)) children.push(new TuiSpacer(1));
		}
		this.contentContainer.children = children;
	}
}

class PerBlockLayoutStub {
	constructor(message) {
		this.contentContainer = { children: [] };
		if (message) this.updateContent(message);
	}
	// mirrors Pi 0.78: every visible thinking block gets its own child
	updateContent(message) {
		const children = [];
		if (message.content.some(isVisibleBlock)) children.push(new TuiSpacer(1));
		for (let i = 0; i < message.content.length; i++) {
			const block = message.content[i];
			if (block.type === "text" && block.text.trim()) {
				children.push(new TuiMarkdown(block.text.trim(), 1, 0));
				continue;
			}
			if (block.type !== "thinking" || !block.thinking.trim()) continue;
			children.push(new TuiMarkdown(block.thinking.trim(), 1, 0));
			if (message.content.slice(i + 1).some(isVisibleBlock)) children.push(new TuiSpacer(1));
		}
		this.contentContainer.children = children;
	}
}

// Cold start: the first message the mapper ever sees is an errored one whose trailing core
// children hide the real layout. A fresh module instance per host proves the resolved layout
// depends on the host alone, not on message history, order or stop reason.
const ambiguousMessage = {
	role: "assistant",
	stopReason: "error",
	content: [
		{ type: "thinking", thinking: "alpha" },
		{ type: "thinking", thinking: "   " },
		{ type: "thinking", thinking: "beta" },
		{ type: "text", text: "final" },
	],
};
const layoutExpectations = [
	{
		StubClass: GroupedLayoutStub,
		label: "grouped (Pi >= 0.84)",
		runs: [
			{ kind: "thinking", childIndex: 1, text: "alpha\n\nbeta" },
			{ kind: "text", childIndex: 3, text: "final" },
		],
	},
	{
		StubClass: PerBlockLayoutStub,
		label: "per-block (Pi 0.78)",
		runs: [
			{ kind: "thinking", childIndex: 1, text: "alpha" },
			{ kind: "thinking", childIndex: 3, text: "beta" },
			{ kind: "text", childIndex: 5, text: "final" },
		],
	},
];

for (const { StubClass, label, runs: expectedRuns } of layoutExpectations) {
	const coldModule = await importBuilt("messages/assistant-content-runs.js");
	const component = new StubClass(ambiguousMessage);
	component.contentContainer.children.push(new TuiSpacer(1), new TuiMarkdown("request failed", 1, 0));
	const runs = coldModule.getAssistantContentRuns(component, ambiguousMessage);
	assert(runs.length === expectedRuns.length, `${label} cold start: should resolve ${expectedRuns.length} rendered runs`);
	for (let i = 0; i < expectedRuns.length; i++) {
		const expected = expectedRuns[i];
		assert(
			runs[i].kind === expected.kind && runs[i].childIndex === expected.childIndex && runs[i].text === expected.text,
			`${label} cold start: run ${i} should be ${expected.kind} at child ${expected.childIndex}`,
		);
	}
}

// One module instance must keep answering per host, whatever order the hosts arrive in.
const sharedModule = await importBuilt("messages/assistant-content-runs.js");
for (const StubClass of [PerBlockLayoutStub, GroupedLayoutStub, PerBlockLayoutStub, GroupedLayoutStub]) {
	const expectedLength = StubClass === GroupedLayoutStub ? 2 : 3;
	const runs = sharedModule.getAssistantContentRuns(new StubClass(ambiguousMessage), ambiguousMessage);
	assert(runs.length === expectedLength, `${StubClass.name}: interleaved hosts must not share layout state`);
}

// Consumer 3: the streaming markdown cache must seed each rendered run's own child.
const { installAssistantStreamingMarkdownCache } = await importBuilt("messages/streaming-markdown-cache.js");
installAssistantStreamingMarkdownCache(GroupedLayoutStub);
const constructionsBeforeStreaming = GroupedLayoutStub.constructions;
const streamingStub = new GroupedLayoutStub({
	role: "assistant",
	content: [
		{ type: "thinking", thinking: "cachedthought one" },
		{ type: "thinking", thinking: "cachedthought two" },
		{ type: "text", text: "CACHEDANSWER" },
	],
});
// The host is now patched, so probing re-enters the mapper through updateContent. It must
// answer from cache instead of probing again: one explicit build plus exactly one probe.
assert(
	GroupedLayoutStub.constructions - constructionsBeforeStreaming === 2,
	`probing a patched host must not recurse (built ${GroupedLayoutStub.constructions - constructionsBeforeStreaming} components)`,
);

const stubChildren = streamingStub.contentContainer.children;
assert(stubChildren.length === 4, "grouped stub should build four content children");
const cachedFinal = stubChildren[3].render(46).map(stripAnsi).join("\n");
assert(cachedFinal.includes("CACHEDANSWER"), "streaming cache must seed the final text child with the final response");
assert(!cachedFinal.includes("cachedthought"), "streaming cache must not seed the final text child with thinking content");


rmSync(built.workDir, { recursive: true, force: true });
console.log("content-runs smoke ok");
