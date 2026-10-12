#!/usr/bin/env node
/**
 * Assistant content-run mapping: Pi 1.x renders consecutive thinking blocks as one child, so child
 * lookups must follow rendered runs. Also pins that the streaming markdown cache seeds each run's own child.
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
// must address rendered runs.
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
		assert(stripAnsi(finalRow).indexOf("FINALANSWER") === 3, `${label}: final response should sit right after the 3-cell rail`);
		if (hideThinking) {
			// The collapsed row is `thinking ▸/· …tail`; it must be the thinking child, not the answer.
			const hiddenRow = rowWith(raw, "thinking");
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

// Runs map onto Pi 1.x's real child layout (consecutive thinking blocks = one child, a Spacer
// after a thinking run). Errored message: trailing core children must not shift the mapping.
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
const { getAssistantContentRuns } = await importBuilt("messages/assistant-content-runs.js");
const runs = getAssistantContentRuns(ambiguousMessage);
assert(runs.length === 2 && runs[0].kind === "thinking" && runs[0].text === "alpha\n\nbeta" && runs[0].childIndex === 1 && runs[1].kind === "text" && runs[1].text === "final" && runs[1].childIndex === 3, `runs should be thinking@1 + text@3, got ${JSON.stringify(runs)}`);
const realChildren = new AssistantMessageComponent(ambiguousMessage, false).contentContainer.children;
const childText = (index) => stripAnsi(realChildren[index].render(46).join("\n"));
assert(childText(1).includes("alpha") && childText(1).includes("beta"), `run 0 must address the real thinking child: ${childText(1)}`);
assert(childText(3).includes("final") && !childText(3).includes("alpha"), `run 1 must address the real text child: ${childText(3)}`);

// The streaming markdown cache must seed each rendered run's own child on the real component.
const { installAssistantStreamingMarkdownCache } = await importBuilt("messages/streaming-markdown-cache.js");
installAssistantStreamingMarkdownCache(AssistantMessageComponent);
const streamed = new AssistantMessageComponent({
	role: "assistant",
	content: [
		{ type: "thinking", thinking: "cachedthought one" },
		{ type: "thinking", thinking: "cachedthought two" },
		{ type: "text", text: "CACHEDANSWER" },
	],
}, false);
const streamedChildren = streamed.contentContainer.children;
assert(streamedChildren.length === 4, `Pi 1.x builds four content children here, got ${streamedChildren.length}`);
const cachedFinal = streamedChildren[3].render(46).map(stripAnsi).join("\n");
assert(cachedFinal.includes("CACHEDANSWER"), "streaming cache must seed the final text child with the final response");
assert(!cachedFinal.includes("cachedthought"), "streaming cache must not seed the final text child with thinking content");

rmSync(built.workDir, { recursive: true, force: true });
console.log("content-runs smoke ok");
