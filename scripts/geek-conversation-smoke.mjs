#!/usr/bin/env node
/**
 * Conversation rows on the real Pi components (user, assistant, compaction/skill/branch/custom):
 * every row stays inside the width and on the rail, only the first assistant message of a turn prints
 * a head row, head times come from the message timestamp. Prints the rendered rows for eyeballing.
 */
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { visibleWidth } from "@earendil-works/pi-tui";
import { buildSmoke } from "./smoke-build.mjs";

const built = buildSmoke("geek-conversation-smoke", [
	"messages/user-prefix.ts",
	"messages/assistant-prefix.ts",
	"messages/core-message-blocks.ts",
	"messages/message-meta.ts",
	"messages/chat-frame.ts",
	"messages/markdown-codeblock-renderer.ts",
	"tool-tags/tool-groups.ts",
]);

const failures = [];
const expect = (name, condition, detail = "") => {
	if (!condition) failures.push(`${name}${detail ? `: ${detail}` : ""}`);
};
const plain = (text) => String(text).replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "").replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");

const core = await import("@earendil-works/pi-coding-agent");
// Pi core ships its own pi-tui copy; the Markdown patch must land on the class its components use.
const corePiTui = join(process.cwd(), "node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-tui/dist/index.js");
const { Markdown, Container, Spacer } = await import(existsSync(corePiTui) ? corePiTui : "@earendil-works/pi-tui");
core.initTheme("dark");

const { installUserMessagePrefix } = await built.importBuilt("messages/user-prefix.js");
const { installAssistantMessagePrefix } = await built.importBuilt("messages/assistant-prefix.js");
const { installCoreMessageBlockStyling, setCoreMessageBlockTheme } = await built.importBuilt("messages/core-message-blocks.js");
const { installMessageMeta } = await built.importBuilt("messages/message-meta.js");
const { installMarkdownCodeBlockRenderer } = await built.importBuilt("messages/markdown-codeblock-renderer.js");
const { frameChatChild } = await built.importBuilt("messages/chat-frame.js");
const { renderChatChildren } = await built.importBuilt("tool-tags/tool-groups.js");

installMarkdownCodeBlockRenderer(Markdown);
installMarkdownCodeBlockRenderer(); // the extension's own pi-tui copy (same class under Pi's module aliasing)
installUserMessagePrefix();
installAssistantMessagePrefix();
installCoreMessageBlockStyling(core);
setCoreMessageBlockTheme(core.theme);

// A stand-in for InteractiveMode: same addMessageToChat shape (user -> UserMessageComponent, assistant -> AssistantMessageComponent).
class FakeInteractiveMode {
	chatContainer = new Container();
	// Pi keeps a Spacer(1) between the chat and the input zone (renderWidgets in interactive-mode.js).
	widgetContainerAbove = new Container();
	renderWidgetContainer(container) {
		container.clear();
		container.addChild(new Spacer(1));
	}
	renderWidgets() {
		this.renderWidgetContainer(this.widgetContainerAbove);
	}
	addMessageToChat(message) {
		if (message.role === "user") this.chatContainer.addChild(new core.UserMessageComponent(message.content));
		if (message.role === "assistant") this.chatContainer.addChild(new core.AssistantMessageComponent(message, true));
	}
}
installMessageMeta(FakeInteractiveMode);

const clock = (ts) => `${String(new Date(ts).getHours()).padStart(2, "0")}:${String(new Date(ts).getMinutes()).padStart(2, "0")}`;
const T_USER = new Date(2026, 9, 12, 14, 52, 10).getTime();
const T_AGENT = new Date(2026, 9, 12, 14, 53, 40).getTime();
const markdownAnswer = [
	"## cause",
	"`REFRESH_TTL` is in seconds but `sign()` takes ms, so the token lives 300 ms instead of 300 s.",
	"",
	"- fix `session.ts` line 20",
	"- rerun the 14 tests",
	"",
	"```ts",
	"const exp = now + REFRESH_TTL * 1000;",
	"```",
].join("\n");

// Chat rows that are not our own components (Pi's showStatus / showWarning / showError / extension notify)
// must follow the row grammar too. Built by Pi's real methods on a stand-in `this`.
const frameAll = (children, width) => children.flatMap((child, index) => frameChatChild(child, width, children[index + 1]));
const piNotices = () => ({ chatContainer: new Container(), ui: { requestRender() {} } });
const beforeTurn = piNotices();
core.InteractiveMode.prototype.showStatus.call(beforeTurn, "Memory injected: 1 files (message-append)");
const beforeRows = frameAll(beforeTurn.chatContainer.children, 80).map(plain);
expect("status before any turn: blank rail, body at col 8", beforeRows.length === 2 && beforeRows[1][6] === " " && beforeRows[1].slice(8).startsWith("Memory injected"), JSON.stringify(beforeRows));

const mode = new FakeInteractiveMode();
mode.addMessageToChat({ role: "user", content: "refresh token expires after 5 minutes,\nfix it", timestamp: T_USER });
mode.addMessageToChat({ role: "assistant", timestamp: T_AGENT, stopReason: "toolUse", content: [{ type: "toolCall", id: "1", name: "read", arguments: {} }] });
mode.addMessageToChat({ role: "assistant", timestamp: T_AGENT + 60_000, stopReason: "stop", content: [{ type: "thinking", thinking: "check units" }, { type: "text", text: markdownAnswer }] });
mode.addMessageToChat({ role: "user", content: "thanks", timestamp: T_AGENT + 120_000 });
mode.addMessageToChat({ role: "assistant", timestamp: T_AGENT + 130_000, stopReason: "stop", content: [{ type: "text", text: "done" }] });
const [userA, agentTools, agentText, userB, agentB] = mode.chatContainer.children;

// A turn whose first assistant message only issues tool calls: tools folds it (and its tool components)
// into one group row and never renders it, so the head must come from the group.
const foldMode = new FakeInteractiveMode();
foldMode.addMessageToChat({ role: "user", content: "run it", timestamp: T_USER });
foldMode.addMessageToChat({ role: "assistant", timestamp: T_AGENT, stopReason: "toolUse", content: [{ type: "toolCall", id: "1", name: "read", arguments: { path: "session.ts" } }] });
foldMode.chatContainer.addChild({ toolCallId: "1", toolName: "read", args: { path: "session.ts" }, result: { content: [{ type: "text", text: "x" }] }, expanded: false, render: () => [] });
foldMode.addMessageToChat({ role: "assistant", timestamp: T_AGENT + 5_000, stopReason: "stop", content: [{ type: "text", text: "all good" }] });
const foldedRows = renderChatChildren(foldMode.chatContainer.children, 80).map(plain);
const foldedAgentHeads = foldedRows.filter((row) => row[6] === "•" && row.includes("pi@agent"));
expect("folded tool-only opener still prints the agent head once, above the group", foldedAgentHeads.length === 1 && foldedAgentHeads[0].startsWith(clock(T_AGENT)) && foldedRows.findIndex((row) => row.includes("pi@agent")) < foldedRows.findIndex((row) => row.includes("› read")), JSON.stringify(foldedRows));

// Pi's widget spacer between chat and input zone is railed, so the rail has no un-railed gap before the input head.
const spacerRows = mode.widgetContainerAbove.render(80).map(plain);
expect("widget spacer row is railed", spacerRows.length === 1 && spacerRows[0][6] === "│", JSON.stringify(spacerRows));

// Inside a turn: status/warning/error sit on the rail (Pi's spacers too), and Pi's in-place status replacement still works.
const inTurn = piNotices();
core.InteractiveMode.prototype.showStatus.call(inTurn, "Tool output: collapsed");
core.InteractiveMode.prototype.showStatus.call(inTurn, "Tool output: expanded");
expect("back-to-back statuses still update in place", inTurn.chatContainer.children.length === 2 && plain(inTurn.chatContainer.children[1].render(40).join("")).includes("expanded"));
core.InteractiveMode.prototype.showWarning.call(inTurn, "careful");
core.InteractiveMode.prototype.showError.call(inTurn, "boom");
for (const width of [24, 40, 80]) {
	for (const row of frameAll(inTurn.chatContainer.children, width)) {
		expect(`notice row fits @${width}`, visibleWidth(row) <= width, JSON.stringify(plain(row)));
		expect(`notice row on rail @${width}`, plain(row)[6] === "│", JSON.stringify(plain(row)));
	}
}
const noticeRows = frameAll(inTurn.chatContainer.children, 80).map(plain);
expect("notice bodies start at col 8", ["Tool output: expanded", "Warning: careful", "Error: boom"].every((text) => noticeRows.some((row) => row.slice(8).startsWith(text))), JSON.stringify(noticeRows));
const turnGap = frameAll([new Spacer(1), userA], 80).map(plain);
expect("the spacer before a user message stays un-railed (turn boundary)", turnGap[0][6] === " ");

const blocks = [
	new core.CompactionSummaryMessageComponent({ role: "compactionSummary", summary: "## Goal\nfix refresh ttl", tokensBefore: 12345, timestamp: T_USER }),
	new core.BranchSummaryMessageComponent({ role: "branchSummary", summary: "tried 300 ms", fromId: "x", timestamp: T_USER }),
	new core.SkillInvocationMessageComponent({ name: "review", location: "x", content: "skill body", userMessage: undefined }),
	new core.CustomMessageComponent({ role: "custom", customType: "note", content: "plain custom text", display: true, timestamp: T_USER }, undefined),
];
const expanded = new core.CompactionSummaryMessageComponent({ role: "compactionSummary", summary: "## Goal\nfix refresh ttl", tokensBefore: 12345, timestamp: T_USER });
expanded.setExpanded(true);

const all = { userA, agentTools, agentText, userB, agentB, ...Object.fromEntries(blocks.map((block, i) => [`block${i}`, block])), expanded };

// Invariant: every row fits the width and (for non-empty rows) sits on the rail.
for (const width of [24, 40, 80]) {
	for (const [name, component] of Object.entries(all)) {
		for (const row of component.render(width)) {
			expect(`${name}@${width} row fits`, visibleWidth(row) <= width, JSON.stringify(plain(row)));
			expect(`${name}@${width} row on rail`, "•│┃".includes(plain(row)[6] ?? "│"), JSON.stringify(plain(row)));
		}
	}
}

const rows = (component, width = 80) => component.render(width).map(plain);
const heads = (component) => rows(component).filter((row) => row[6] === "•");

// Turn heads: user always; assistant only for the first message of the turn.
expect("user prints a head with the message time", heads(userA).length === 1 && heads(userA)[0].startsWith(clock(T_USER)), JSON.stringify(heads(userA)));
expect("first assistant of a turn prints the head", heads(agentTools).length === 1 && heads(agentTools)[0].includes("pi@agent") && heads(agentTools)[0].startsWith(clock(T_AGENT)), JSON.stringify(heads(agentTools)));
expect("second assistant in the same turn has no head", heads(agentText).length === 0);
expect("next turn opens a new head", heads(userB).length === 1 && heads(agentB).length === 1);
expect("tool-call-only message renders no body rows", rows(agentTools).filter((row) => row[6] === "│").length === 0);

// Prompt / markdown / core blocks.
const userRows = rows(userA);
expect("prompt rows", userRows[1]?.includes("│ › refresh token") && userRows[2]?.includes("│   fix it"), JSON.stringify(userRows));
const answer = rows(agentText).join("\n");
expect("heading keeps its ## marks", answer.includes("## cause"));
expect("inline code keeps backticks", answer.includes("`REFRESH_TTL`") && answer.includes("`sign()`"));
expect("list bullets", answer.includes("- fix `session.ts` line 20"));
expect("collapsed thinking row", answer.includes("thinking ·"), answer);
expect("compaction collapsed: grouped tokens + expand hint", rows(blocks[0]).some((row) => row.includes("compaction") && row.includes("12'345 tokens") && row.includes("^o")));
expect("compaction expanded: summary body", rows(expanded).some((row) => row.includes("## Goal")) && !rows(expanded).some((row) => row.includes("^o")));
expect("skill/branch/custom heads", rows(blocks[1]).some((r) => r.includes("branch")) && rows(blocks[2]).some((r) => r.includes("skill") && r.includes("review")) && rows(blocks[3]).some((r) => r.includes("note")) && rows(blocks[3]).some((r) => r.includes("plain custom text")));

console.log(["userA", "agentTools", "agentText", "userB", "agentB"].flatMap((name) => all[name].render(72).map((row) => row)).join("\n"));
console.log([...blocks, expanded].flatMap((block) => block.render(72)).join("\n"));

rmSync(built.workDir, { recursive: true, force: true });
if (failures.length) {
	console.error(`geek conversation smoke FAILED (${failures.length}):\n- ${failures.join("\n- ")}`);
	process.exit(1);
}
console.log("geek conversation smoke ok");
