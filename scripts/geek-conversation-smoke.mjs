#!/usr/bin/env node
/**
 * Conversation rows on the real Pi components (user, assistant, compaction/skill/branch/custom):
 * every row stays inside the width and on the rail, only the first assistant message of a turn prints
 * a head row. Prints the rendered rows for eyeballing.
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
	"performance/virtualize-chat.ts",
	"theme/geek-theme.ts",
	"theme/geek-palette.ts",
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
const { createGeekTheme } = await built.importBuilt("theme/geek-theme.js");
const { GEEK_PALETTE } = await built.importBuilt("theme/geek-palette.js");
const { frameChatChild } = await built.importBuilt("messages/chat-frame.js");
const { renderChatChildren } = await built.importBuilt("tool-tags/tool-groups.js");
const { virtualizeChatContainerInstance } = await built.importBuilt("performance/virtualize-chat.js");

installMarkdownCodeBlockRenderer(Markdown);
installMarkdownCodeBlockRenderer(); // the extension's own pi-tui copy (same class under Pi's module aliasing)
installUserMessagePrefix();
installAssistantMessagePrefix();
installCoreMessageBlockStyling(core);
setCoreMessageBlockTheme(core.theme);

// A stand-in for InteractiveMode: same addMessageToChat shape (user -> UserMessageComponent, assistant -> AssistantMessageComponent).
class FakeInteractiveMode {
	ui = { requestRender() {} };
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
	renderInitialMessages(messages = []) {
		for (const message of messages) this.addMessageToChat(message);
	}
	addMessageToChat(message) {
		if (message.role === "user") this.chatContainer.addChild(new core.UserMessageComponent(message.content));
		if (message.role === "assistant") this.chatContainer.addChild(new core.AssistantMessageComponent(message, true));
	}
}
installMessageMeta(FakeInteractiveMode);

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
const frameAll = (children, width) => children.flatMap((child, index) => frameChatChild(child, width, children[index + 1], children[index - 1]));
const piNotices = () => ({ chatContainer: new Container(), ui: { requestRender() {} } });
const beforeTurn = piNotices();
core.InteractiveMode.prototype.showStatus.call(beforeTurn, "Memory injected: 1 files (message-append)");
const beforeRows = frameAll(beforeTurn.chatContainer.children, 80).map(plain);
expect("status before any turn: blank rail, body at col 3", beforeRows.length === 2 && beforeRows[1][1] === " " && beforeRows[1].slice(3).startsWith("Memory injected"), JSON.stringify(beforeRows));

// ...and it stays that way once a turn starts later (the rail decision is made at first render).
const mode = new FakeInteractiveMode();
mode.renderWidgets();
const emptySpacerRows = mode.widgetContainerAbove.render(80).map(plain);
expect("empty session widget spacer stays off the rail", emptySpacerRows.length === 1 && emptySpacerRows[0].trim() === "", JSON.stringify(emptySpacerRows));
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
const foldedAgentHeads = foldedRows.filter((row) => row[1] === "•" && row.includes("pi@agent"));
expect("folded tool-only opener still prints the agent head once, above the group", foldedAgentHeads.length === 1 && foldedRows.findIndex((row) => row.includes("pi@agent")) < foldedRows.findIndex((row) => row.includes("R session.ts")), JSON.stringify(foldedRows));

// Clicks hit the rows geek drew, not Pi's child heights (tool groups fold rows, head rows add them).
const clickMode = new FakeInteractiveMode();
clickMode.addMessageToChat({ role: "user", content: "run it", timestamp: T_USER });
clickMode.addMessageToChat({ role: "assistant", timestamp: T_AGENT, stopReason: "toolUse", content: [{ type: "toolCall", id: "2", name: "read", arguments: { path: "a.ts" } }] });
const clickTool = {
	toolCallId: "2", toolName: "read", args: { path: "a.ts" }, result: { content: [{ type: "text", text: "x" }] }, expanded: false,
	setExpanded(expanded) { this.expanded = expanded; },
	render: () => ["", "pi row", "pi row", "pi row", "pi row"],
};
clickMode.chatContainer.addChild(clickTool);
clickMode.addMessageToChat({ role: "assistant", timestamp: T_AGENT + 5_000, stopReason: "stop", content: [{ type: "thinking", thinking: "check units" }, { type: "text", text: "all good" }] });
const chat = clickMode.chatContainer;
virtualizeChatContainerInstance(chat, 30);
const chatRows = () => chat.render(80).map(plain);
const clickRow = (match) => {
	const y = chatRows().findIndex(match);
	chat.handleMouse({ type: "click", button: "left", x: 5, y, screenX: 5, screenY: y, width: 80, height: 100 });
};
const hiddenThinking = (row) => /thinking/i.test(row) && row.includes("check units");
clickRow((row) => row.includes("R a.ts"));
expect("click on a tool group row toggles that group", clickTool.expanded === true, JSON.stringify(chatRows()));
clickRow(hiddenThinking);
expect("click on a collapsed thinking row shows that run", !chatRows().some(hiddenThinking) && chatRows().some((row) => row.includes("check units")), JSON.stringify(chatRows()));

// Pi's widget spacer between chat and input zone is railed, so the rail has no un-railed gap before the input head.
const spacerRows = mode.widgetContainerAbove.render(80).map(plain);
expect("widget spacer row is railed", spacerRows.length === 1 && spacerRows[0][1] === "┊", JSON.stringify(spacerRows));

expect("a startup notice stays off the rail after a turn began", frameAll(beforeTurn.chatContainer.children, 80).map(plain)[1][1] === " ");

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
		expect(`notice row on rail @${width}`, plain(row)[1] === "┊", JSON.stringify(plain(row)));
	}
}
const noticeRows = frameAll(inTurn.chatContainer.children, 80).map(plain);
expect("notice bodies start at col 3", ["Tool output: expanded", "Warning: careful", "Error: boom"].every((text) => noticeRows.some((row) => row.slice(3).startsWith(text))), JSON.stringify(noticeRows));
// Exactly one railed blank between blocks: a Pi spacer after a grammar block (or another spacer) adds nothing.
const sepRows = frameAll([userA, new Spacer(1), new Spacer(1)], 80).map(plain);
expect("spacer after a railed block adds no second blank", sepRows.filter((row) => row.trim() === "┊").length === 1, JSON.stringify(sepRows));
const noticeGap = frameAll(inTurn.chatContainer.children, 80).map(plain);
expect("no two consecutive blank railed rows around notices", noticeGap.every((row, i) => !(i > 0 && row.trim() === "┊" && noticeGap[i - 1].trim() === "┊")), JSON.stringify(noticeGap));
const turnGap = frameAll([new Spacer(1), userA], 80).map(plain);
expect("the spacer before a user message stays un-railed (turn boundary)", turnGap[0][1] === " ");

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
			expect(`${name}@${width} row on rail`, "•┊┃".includes(plain(row)[1] ?? "┊"), JSON.stringify(plain(row)));
		}
	}
}

const rows = (component, width = 80) => component.render(width).map(plain);
const heads = (component) => rows(component).filter((row) => row[1] === "•");

// Turn heads: user always; assistant only for the first message of the turn.
expect("user prints one head", heads(userA).length === 1, JSON.stringify(heads(userA)));
expect("first assistant of a turn prints the head", heads(agentTools).length === 1 && heads(agentTools)[0].includes("pi@agent"), JSON.stringify(heads(agentTools)));
expect("second assistant in the same turn has no head", heads(agentText).length === 0);
expect("next turn opens a new head", heads(userB).length === 1 && heads(agentB).length === 1);
expect("tool-call-only message renders no body rows", rows(agentTools).filter((row) => row[1] === "┊").length === 0);

// Prompt / markdown / core blocks.
const userRows = rows(userA);
expect("prompt rows", userRows[1]?.includes("┊ › refresh token") && userRows[2]?.includes("┊   fix it"), JSON.stringify(userRows));
// User body rows sit on the panel surface from the body column to the chat edge; head and the closing blank stay on the page.
const PANEL_BG = "\x1b[48;2;20;20;20m";
for (const width of [24, 40, 80]) {
	const raw = userA.render(width);
	const body = raw.slice(1, -1);
	expect(`user body rows carry the panel bg from col 3 to the edge @${width}`, body.length >= 2 && body.every((row) => plain(row.slice(0, row.indexOf(PANEL_BG))).length === 3 && visibleWidth(row) === width && row.includes("\x1b[49m")), JSON.stringify(body));
	expect(`user head and closing blank stay on the page @${width}`, !raw[0].includes("[48;") && !raw.at(-1).includes("[48;"), JSON.stringify([raw[0], raw.at(-1)]));
}
const answer = rows(agentText).join("\n");
expect("heading keeps its ## marks", answer.includes("## cause"));
expect("inline code keeps backticks", answer.includes("`REFRESH_TTL`") && answer.includes("`sign()`"));
expect("list bullets", answer.includes("- fix `session.ts` line 20"));
expect("collapsed thinking row", answer.includes("thinking ·"), answer);
expect("compaction collapsed: grouped tokens + expand hint", rows(blocks[0]).some((row) => row.includes("compaction") && row.includes("12'345 tokens") && row.includes("^o")));
expect("compaction expanded: summary body", rows(expanded).some((row) => row.includes("## Goal")) && !rows(expanded).some((row) => row.includes("^o")));
expect("skill/branch/custom heads", rows(blocks[1]).some((r) => r.includes("branch")) && rows(blocks[2]).some((r) => r.includes("skill") && r.includes("review")) && rows(blocks[3]).some((r) => r.includes("note")) && rows(blocks[3]).some((r) => r.includes("plain custom text")));

// Code blocks: base `dim`, syntax tokens in palette colors, never the terminal default fg. Highlighting must
// come from the geek host theme (Pi resolves it from the global theme at call time).
const THEME_KEY = Symbol.for("@earendil-works/pi-coding-agent:theme");
const previousTheme = globalThis[THEME_KEY];
globalThis[THEME_KEY] = createGeekTheme();
const rgbOf = (hex) => `${parseInt(hex.slice(1, 3), 16)};${parseInt(hex.slice(3, 5), 16)};${parseInt(hex.slice(5, 7), 16)}`;
const roleOf = {};
for (const [role, hex] of Object.entries(GEEK_PALETTE)) roleOf[rgbOf(hex)] ??= role; // first role wins (dim before badgeBg)
const codeAnswer = new core.AssistantMessageComponent({ role: "assistant", stopReason: "stop", content: [{ type: "text", text: [
	"```ts", "const exp: number = now + 1000; // ms", "```", "```bash", "pnpm test auth && echo \"done\" # run", "```", "```json", "{ \"ttl\": 300, \"ok\": true }", "```", "```", "plain block with 42 things", "```",
].join("\n") }] }, true);
const tokens = (needle) => {
	const row = codeAnswer.render(100).find((r) => plain(r).includes(needle));
	const out = [];
	let fg;
	for (const part of String(row).split(/(\x1b\[[0-9;]*m)/)) {
		const sgr = /^\x1b\[([0-9;]*)m$/.exec(part);
		if (sgr) fg = sgr[1].startsWith("38;2;") ? roleOf[sgr[1].slice(5)] ?? `rgb(${sgr[1].slice(5)})` : sgr[1] === "39" || sgr[1] === "0" || sgr[1] === "" ? undefined : fg;
		else if (part.replace(/\x1b\][^\x07]*\x07/g, "").trim()) out.push({ text: part.replace(/\x1b\][^\x07]*\x07/g, ""), fg });
	}
	return out.filter((t, i) => !(i === 0 && t.text.includes("┊")) && !t.text.includes("┊"));
};
for (const needle of ["const exp", "pnpm test", '"ttl"', "plain block"]) {
	const toks = tokens(needle);
	expect(`code row "${needle}": every token has a palette fg (no terminal-default runs)`, toks.length > 0 && toks.every((t) => ["dim", "faint", "num", "kw", "mono", "punct"].includes(t.fg)), JSON.stringify(toks));
}
expect("ts: keyword kw, number num, comment faint, plain code dim", (() => { const t = tokens("const exp"); const by = (s) => t.find((x) => x.text.includes(s))?.fg; return by("const") === "kw" && by("1000") === "num" && by("// ms") === "faint" && by("exp:") === "dim"; })(), JSON.stringify(tokens("const exp")));
expect("json: number num, string mono", (() => { const t = tokens('"ttl"'); const by = (s) => t.find((x) => x.text.includes(s))?.fg; return by("300") === "num"; })(), JSON.stringify(tokens('"ttl"')));
expect("unlabeled block is plain dim", tokens("plain block").every((t) => t.fg === "dim" || t.fg === "num"), JSON.stringify(tokens("plain block")));
globalThis[THEME_KEY] = previousTheme;

mode.chatContainer.clear();
mode.renderInitialMessages();
core.InteractiveMode.prototype.showStatus.call(mode, "New session started");
expect("new session notices do not inherit the previous turn rail", frameAll(mode.chatContainer.children, 80).map(plain).every((row) => row[1] === " "));
expect("new session widget spacer drops the previous turn rail", mode.widgetContainerAbove.render(80).map(plain).every((row) => row.trim() === ""));
mode.addMessageToChat({ role: "user", content: "new turn", timestamp: T_USER });
expect("first turn restores the widget rail", mode.widgetContainerAbove.render(80).map(plain)[0]?.[1] === "┊");

const dockRows = (host) => host.widgetContainerAbove.render(80).map(plain);
const fullscreenHost = new FakeInteractiveMode();
fullscreenHost.renderer = { mode: "fullscreen" };
const regularHost = new FakeInteractiveMode();
regularHost.renderer = { mode: "regular" };
fullscreenHost.renderInitialMessages();
regularHost.renderInitialMessages();
fullscreenHost.renderWidgets();
regularHost.renderWidgets();
expect("fullscreen spacer is one blank row before the first user message", dockRows(fullscreenHost).length === 1 && dockRows(fullscreenHost)[0].trim() === "", JSON.stringify(dockRows(fullscreenHost)));
fullscreenHost.addMessageToChat({ role: "user", content: "fullscreen turn", timestamp: T_USER });
const fullscreenAfter = dockRows(fullscreenHost);
expect("fullscreen spacer stays one blank row after the first user message", fullscreenAfter.length === 1 && fullscreenAfter[0].trim() === "", JSON.stringify(fullscreenAfter));
expect("regular spacer keeps the rail after the first user message", dockRows(regularHost)[0]?.[1] === "┊", JSON.stringify(dockRows(regularHost)));
fullscreenHost.renderer = { mode: "regular" };
expect("spacer follows a regular renderer swapped in without rebuilding widgets", dockRows(fullscreenHost)[0]?.[1] === "┊", JSON.stringify(dockRows(fullscreenHost)));
fullscreenHost.renderer = { mode: "fullscreen" };
expect("spacer follows a fullscreen renderer swapped back without rebuilding widgets", dockRows(fullscreenHost).length === 1 && dockRows(fullscreenHost)[0].trim() === "", JSON.stringify(dockRows(fullscreenHost)));

mode.chatContainer.clear();
mode.renderInitialMessages([
	{ role: "user", content: "resumed turn", timestamp: T_USER },
	{ role: "assistant", timestamp: T_AGENT, stopReason: "stop", content: [{ type: "text", text: "resumed answer" }] },
]);
expect("resumed conversation restores the widget rail", mode.widgetContainerAbove.render(80).map(plain)[0]?.[1] === "┊");
expect("resumed conversation keeps its assistant head", heads(mode.chatContainer.children[1]).length === 1);

console.log(["userA", "agentTools", "agentText", "userB", "agentB"].flatMap((name) => all[name].render(72).map((row) => row)).join("\n"));
console.log([...blocks, expanded].flatMap((block) => block.render(72)).join("\n"));

rmSync(built.workDir, { recursive: true, force: true });
if (failures.length) {
	console.error(`geek conversation smoke FAILED (${failures.length}):\n- ${failures.join("\n- ")}`);
	process.exit(1);
}
console.log("geek conversation smoke ok");
