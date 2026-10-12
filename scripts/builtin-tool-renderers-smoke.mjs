#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { visibleWidth } from "@earendil-works/pi-tui";

const repoRoot = process.cwd();
// Unique per run: concurrent smoke runs (or parallel agent sessions) must not
// race each other on a shared fixed build dir.
const workDir = mkdtempSync(join(repoRoot, ".pi", "builtin-tool-renderers-smoke-"));
const buildDir = join(workDir, "build");
const stubPath = join(workDir, "node-stubs.d.ts");
const tsc = join(repoRoot, "node_modules", "typescript", "lib", "tsc.js");
// edit reads diffMode from ~/.pi/agent/pi-geek-tui.json: keep the user's real config out of the run.
process.env.HOME = workDir;

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

function prepareWorkDir() {
	mkdirSync(buildDir, { recursive: true });
	writeFileSync(join(buildDir, "package.json"), "{\"type\":\"module\"}\n", "utf8");
	writeFileSync(stubPath, `declare module "@earendil-works/pi-coding-agent" {
	export type AgentToolResult<T> = any;
	export type ToolRenderResultOptions = any;
	export type ExtensionAPI = any;
	export type Theme = any;
	export const getLanguageFromPath: any;
	export const highlightCode: any;
	export const createEditToolDefinition: any;
	export const ToolExecutionComponent: any;
	export const getAgentDir: any;
}
declare module "@earendil-works/pi-tui" {
	export type Component = any;
	export const Text: any;
	export const truncateToWidth: any;
	export const visibleWidth: any;
	export const wrapTextWithAnsi: any;
}
declare module "node:fs";
declare module "node:path";
declare module "node:url";
declare module "node:os";
declare module "fs";
declare module "path";
declare module "os";
declare const process: any;
`, "utf8");

	// Runtime stubs so the compiled modules do not load the real SDK.
	const stubAgentPkgDir = join(buildDir, "node_modules", "@earendil-works", "pi-coding-agent");
	mkdirSync(stubAgentPkgDir, { recursive: true });
	writeFileSync(join(stubAgentPkgDir, "package.json"), "{\"name\":\"@earendil-works/pi-coding-agent\",\"version\":\"0.0.0-stub\",\"type\":\"module\",\"main\":\"index.js\"}\n", "utf8");
	writeFileSync(join(stubAgentPkgDir, "index.js"), `export const getLanguageFromPath = (path) => (String(path).endsWith(".ts") ? "typescript" : undefined);
// keyword gets a fg color and a plain fg reset; identifiers stay uncolored like hljs output
export const highlightCode = (code) => String(code).split("\\n").map((line) => line.replace(/\\bconst\\b/, "\\x1b[38;2;104;158;128mconst\\x1b[39m"));
export const getAgentDir = () => "/nonexistent-agent-dir";
export class ToolExecutionComponent {}
`, "utf8");
}

function compileBuiltinToolRenderers() {
	if (!existsSync(tsc)) throw new Error("typescript is not installed; run npm install before npm run test:builtin-tool-renderers");
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
		"tool-tags/builtin-tool-renderers.ts",
		"tool-tags/elapsed.ts",
		"tool-tags/common.ts",
		"tool-tags/register-tool-call-tags.ts",
		"tool-tags/tool-groups.ts",
		"tool-tags/compact-tool-spacing.ts",
	], { cwd: repoRoot, encoding: "utf8" });
	if (result.status !== 0) {
		process.stderr.write(result.stdout || "");
		process.stderr.write(result.stderr || "");
		throw new Error(`TypeScript compile failed with code ${result.status}`);
	}
	console.log("tsc builtin tool renderers ok");
}

function makeFakeComponentClass() {
	let baseCallCalls = 0;
	let baseResultCalls = 0;
	let baseShellCalls = 0;
	class FakeToolExecutionComponent {
		getCallRenderer() {
			baseCallCalls++;
			return this.toolDefinition?.renderCall;
		}
		getResultRenderer() {
			baseResultCalls++;
			return this.toolDefinition?.renderResult;
		}
		getRenderShell() {
			baseShellCalls++;
			return this.toolDefinition?.renderShell;
		}
	}
	return { FakeToolExecutionComponent, baseCallCount: () => baseCallCalls, baseResultCount: () => baseResultCalls, baseShellCount: () => baseShellCalls };
}

async function runBuiltinToolRenderersSmoke() {
	const buildToolTags = (name) => pathToFileURL(join(buildDir, "tool-tags", name)).href;
	const renderers = await import(buildToolTags("builtin-tool-renderers.js"));
	const elapsed = await import(buildToolTags("elapsed.js"));

	const theme = { fg: (_color, text) => text };

	const toolModules = {
		read: await import(buildToolTags("read.js")),
		write: await import(buildToolTags("write.js")),
		edit: await import(buildToolTags("edit.js")),
		ls: await import(buildToolTags("ls.js")),
		find: await import(buildToolTags("find.js")),
		grep: await import(buildToolTags("grep.js")),
		bash: await import(buildToolTags("bash.js")),
	};

	// --- 1. Patch resolution ---
	const { FakeToolExecutionComponent, baseCallCount, baseResultCount, baseShellCount } = makeFakeComponentClass();
	renderers.installBuiltinToolRenderers(FakeToolExecutionComponent);

	const expected = {
		read: ["renderReadCall", "renderReadResult"],
		write: ["renderWriteCall", "renderWriteResult"],
		edit: ["renderEditCall", "renderEditResult"],
		ls: ["renderLsCall", "renderLsResult"],
		find: ["renderFindCall", "renderFindResult"],
		grep: ["renderGrepCall", "renderGrepResult"],
		bash: ["renderBashCall", "renderBashResult"],
	};

	for (const [toolName, [callName, resultName]] of Object.entries(expected)) {
		const instance = Object.assign(new FakeToolExecutionComponent(), { toolName, toolDefinition: {} });
		const callRenderer = instance.getCallRenderer();
		const resultRenderer = instance.getResultRenderer();
		assert(typeof callRenderer === "function", `${toolName}: patched getCallRenderer did not return a function`);
		assert(callRenderer === toolModules[toolName][callName], `${toolName}: call renderer is not the droid ${callName}`);
		assert(typeof resultRenderer === "function", `${toolName}: patched getResultRenderer did not return a function`);
		assert(resultRenderer === toolModules[toolName][resultName], `${toolName}: result renderer is not the droid ${resultName}`);
		assert(instance.getRenderShell() === "self", `${toolName}: getRenderShell did not return "self"`);
	}

	// Unknown names fall through to the base methods.
	const unknownInstance = Object.assign(new FakeToolExecutionComponent(), { toolName: "other_tool", toolDefinition: { renderShell: "self" } });
	assert(unknownInstance.getCallRenderer() === undefined, "unknown tool name did not fall through to base getCallRenderer");
	assert(unknownInstance.getResultRenderer() === undefined, "unknown tool name did not fall through to base getResultRenderer");
	assert(unknownInstance.getRenderShell() === "self", "unknown tool name did not fall through to base getRenderShell");
	assert(baseCallCount() === 1 && baseResultCount() === 1 && baseShellCount() === 1, "base methods were not called exactly once for the unknown tool name");

	// Double install must not double-wrap (Symbol.for guards).
	const callRendererFn = FakeToolExecutionComponent.prototype.getCallRenderer;
	const resultRendererFn = FakeToolExecutionComponent.prototype.getResultRenderer;
	const renderShellFn = FakeToolExecutionComponent.prototype.getRenderShell;
	renderers.installBuiltinToolRenderers(FakeToolExecutionComponent);
	assert(FakeToolExecutionComponent.prototype.getCallRenderer === callRendererFn, "double install re-wrapped getCallRenderer");
	assert(FakeToolExecutionComponent.prototype.getResultRenderer === resultRendererFn, "double install re-wrapped getResultRenderer");
	assert(FakeToolExecutionComponent.prototype.getRenderShell === renderShellFn, "double install re-wrapped getRenderShell");

	// --- 2. Timing resolution ---
	// Recorded start/end events resolve by toolCallId.
	elapsed.recordToolCallTimingStart("t1");
	elapsed.recordToolCallTimingEnd("t1");
	const recorded = elapsed.resolveToolCallElapsedMs({ toolCallId: "t1" }, undefined);
	assert(typeof recorded === "number" && recorded >= 0, "recorded start/end did not resolve elapsed by toolCallId");

	// Frozen state wins over later records.
	elapsed.recordToolCallTimingStart("t2");
	elapsed.recordToolCallTimingEnd("t2");
	const frozenState = { __geekElapsedMs: 999 };
	assert(elapsed.resolveToolCallElapsedMs({ state: frozenState, toolCallId: "t2" }, undefined) === 999, "frozen state value did not win over event records");

	// result.details.__elapsedMs fallback when no record exists.
	assert(elapsed.resolveToolCallElapsedMs({ toolCallId: "t3" }, { details: { __elapsedMs: 1234 } }) === 1234, "details.__elapsedMs fallback did not resolve");


	// --- 3. registerToolCallTags registers edit only when pi-ctx-kit is present (issue #26) ---
	const { registerToolCallTags } = await import(buildToolTags("register-tool-call-tags.js"));
	const registerWith = async () => {
		const registered = [];
		const previousCwd = process.cwd();
		process.chdir(buildDir); // keep the cwd-relative pi-ctx-kit probes off the developer checkout
		try {
			await registerToolCallTags({ registerTool(definition) { registered.push(definition); } });
		} finally {
			process.chdir(previousCwd);
		}
		return registered;
	};
	const withoutKit = await registerWith();
	assert(withoutKit.length === 0, `without pi-ctx-kit nothing may override builtin edit, got ${JSON.stringify(withoutKit.map((d) => d?.name))}`);
	const kitDir = join(buildDir, "node_modules", "pi-ctx-kit");
	mkdirSync(kitDir, { recursive: true });
	writeFileSync(join(kitDir, "package.json"), "{\"name\":\"pi-ctx-kit\",\"type\":\"module\",\"exports\":{\"./edit-core\":\"./edit-core.js\"}}\n", "utf8");
	writeFileSync(join(kitDir, "edit-core.js"), "export const EDIT_TOOL_DESCRIPTION = \"kit edit\";\nexport const EditArgsSchema = {};\nexport const executeEnhancedEdit = async () => ({ content: [] });\n", "utf8");
	const withKit = await registerWith();
	assert(withKit.length === 1 && withKit[0].name === "edit" && withKit[0].description === "kit edit", `with pi-ctx-kit only the enhanced edit should register, got ${JSON.stringify(withKit.map((d) => d?.name))}`);

	// --- 4. Edit results: meta on the call row, diff rows below, per file ---
	const strip = (text) => String(text).replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
	const WIDTH = 90;
	const editBlock = (args, result, isError = false) => {
		const context = { args, isError, cwd: "/repo", state: { __geekElapsedMs: 100 }, toolCallId: "edit-1", isPartial: false };
		const body = toolModules.edit.renderEditResult(result, { expanded: false, isPartial: false }, theme, context).render(WIDTH);
		const call = toolModules.edit.renderEditCall(args, theme, context).render(WIDTH);
		return { body: body.map(strip), call: call.map(strip) };
	};
	const editBlockRaw = (args, result) => {
		const context = { args, isError: false, cwd: "/repo", state: { __geekElapsedMs: 100 }, toolCallId: "edit-2", isPartial: false };
		const body = toolModules.edit.renderEditResult(result, { expanded: false, isPartial: false }, theme, context);
		return { body, call: toolModules.edit.renderEditCall(args, theme, context) };
	};
	const scriptArgs = { paths: ["src/a.ts", "b.md"], code: "x" };

	const failed = editBlock(scriptArgs, {
		isError: true,
		content: [{ type: "text", text: "script edit failed (exit 1) — rolled back to snapshot.\nstderr:\nreplaceOnce: expected 1 match(es) of \"missing\" in n.txt, found 0" }],
		details: { diff: "", patch: "" },
	}, true);
	assert(failed.body.every((line) => !line.includes("\n")), "edit error output embedded a newline inside a row");
	assert(failed.body.some((line) => line.includes("found 0")), "edit error output hid the stderr cause");
	assert(failed.call[0].includes("failed"), "failed edit did not say so on its call row");

	const noop = editBlock(scriptArgs, { content: [{ type: "text", text: "WARNING: no declared file changed.\nstdout:\n0 matches for foo" }], details: { diff: "", patch: "" } });
	assert(noop.body.some((line) => line.includes("0 matches for foo")), "edit no-change output hid the script stdout");

	const multi = editBlock(scriptArgs, {
		content: [{ type: "text", text: "x" }],
		details: { patch: "--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,1 +1,1 @@\n-one\n+ONE\n--- a/b.md\n+++ b/b.md\n@@ -0,0 +1,1 @@\n+---" },
	});
	assert(multi.body.some((line) => line.includes("▸ src/a.ts")) && multi.body.some((line) => line.includes("▸ b.md")), "multi-file edit diff lost its file titles");
	assert(multi.call[0].includes("+2") && multi.call[0].includes("-1"), `script-mode diff stats skipped a '+---' content line: ${multi.call[0]}`);

	// Two hunks: the unchanged run between them folds into one gap row; context around hunks is dropped.
	const twoHunks = editBlock({ path: "src/a.ts" }, { content: [{ type: "text", text: "x" }], details: { diff: ["  1 one", "- 2 two", "+ 2 TWO", "  3 three", "    ...", " 10 ten", "-11 eleven", "+11 ELEVEN", " 12 twelve"].join("\n") } });
	assert(twoHunks.body.filter((line) => line.includes("··· 8 unchanged lines ···")).length === 1, `expected exactly one gap row, got ${JSON.stringify(twoHunks.body)}`);
	assert(!twoHunks.body.some((line) => /\bone\b|twelve/.test(line)), "context before the first / after the last change should be dropped");
	assert(twoHunks.body.every((line) => visibleWidth(line) <= WIDTH), "diff row overflowed the body width");
	const delIndex = twoHunks.body.findIndex((line) => line.includes("- two"));
	assert(delIndex >= 0 && twoHunks.body[delIndex + 1].includes("+ TWO"), "removed line must be followed by its added line");

	// Pi's builtin gutter diff folds context with an unnumbered "..." line: one gap, counted from the next line.
	const splitDiff = await import(pathToFileURL(join(buildDir, "split-diff.js")).href);
	const piRows = splitDiff.buildDiffRows(["  7 line 7", "    ...", " 27 line 27", "-28 old", "+28 new", " 29 line 29", "    ..."].join("\n"));
	const piGaps = piRows.filter((row) => row.kind === "gap");
	assert(piGaps.length === 2 && piGaps[0].count === 19 && piGaps[1].count === undefined, `Pi "..." markers should become gap rows (19, unknown), got ${JSON.stringify(piGaps)}`);
	assert(!piRows.some((row) => row.left?.line.trim() === "..."), "Pi \"...\" marker still rendered as a code line");
	const afterGap = piRows.find((row) => row.left?.line === "line 27");
	assert(afterGap?.right?.lineNumber.trim() === "27", `new-side numbering did not skip the folded lines, got ${afterGap?.right?.lineNumber}`);

	// --- 5. Collapsed tool group: one row per run, edit-class calls break the run ---
	const groups = await import(buildToolTags("tool-groups.js"));
	const tool = (toolName, args, extra = {}) => ({
		toolCallId: `${toolName}-${Math.random()}`, toolName, args, expanded: false, isPartial: false,
		rendererState: {}, result: { content: [], details: { __elapsedMs: 500 } }, render: (w) => [`RAW ${toolName}`.padEnd(w)], ...extra,
	});
	const assistant = (thinking) => ({
		lastMessage: { role: "assistant", content: [...(thinking ? [{ type: "thinking", thinking }] : []), { type: "toolCall" }] },
		render: (w) => [`ASSISTANT`.padEnd(w)],
	});
	const finished = [assistant("check ttl"), tool("read", { path: "src/auth/session.ts" }), tool("read", { path: "src/auth/token.ts" }), tool("grep", { pattern: "REFRESH_TTL" })];
	for (const width of [120, 40]) {
		const rows = groups.renderChatChildren(finished, width).map(strip);
		assert(rows.length === 2 && rows.every((row) => visibleWidth(row) === width), `group rows must be exactly ${width} cells, got ${JSON.stringify(rows)}`);
		if (width === 120) {
			assert(rows[0].includes("› read session.ts token.ts · grep REFRESH_TTL"), `group lost its merged call summary: ${rows[0]}`);
			assert(rows[0].includes("^o  // 3 call · 1 thought · 1.5s"), `group lost its meta: ${rows[0]}`);
		}
	}
	const runningGroup = [tool("bash", { command: "pnpm test auth\nignored" }, { result: undefined, isPartial: true, rendererState: { __geekStartedAt: performance.now() - 4100 } })];
	const runningRows = groups.renderChatChildren(runningGroup, 100).map(strip);
	assert(runningRows[0].includes("┃") && runningRows[0].includes("› pnpm test auth") && runningRows[0].includes("running"), `running group should show the active rail and state: ${runningRows[0]}`);
	assert(!runningRows[0].includes("ignored"), "bash summary must stay on the first command line");

	const editTool = tool("edit", { path: "src/a.ts" });
	const mixed = groups.renderChatChildren([tool("read", { path: "a.ts" }), editTool, tool("bash", { command: "ls" })], 100).map(strip);
	assert(mixed.filter((row) => row.includes("RAW edit")).length === 1 && mixed.filter((row) => row.includes("call")).length === 2, `edit must break the run and render itself: ${JSON.stringify(mixed)}`);

	// --- 6. Running / expanded group renders a tree; expanded bodies stay capped ---
	const readOutput = Array.from({ length: 120 }, (_, i) => `${i + 1}| line ${i + 1}`).join("\n");
	const treeChildren = [
		assistant("3 remaining tests all call rotate() before signing the token and the quick brown fox jumps over the lazy dog"),
		tool("bash", { command: "pnpm test auth" }, { result: { content: [{ type: "text", text: "running\n[11/14]" }] }, isPartial: true, rendererState: { __geekStartedAt: performance.now() - 4100 } }),
		tool("read", { path: "refresh.test.ts" }, { result: { content: [{ type: "text", text: readOutput }], details: {} } }),
	];
	const tree = groups.renderChatChildren(treeChildren, 100).map(strip);
	assert(tree.every((row) => visibleWidth(row) === 100), "tree rows must be exactly the chat width");
	assert(tree[0].includes("┃") && tree[0].includes("// 2 call · 1 thought · running"), `tree head: ${tree[0]}`);
	assert(tree[1].includes("├── T thinking") && tree[1].includes('"3 remaining') && tree[1].includes("…"), `thought node: ${tree[1]}`);
	assert(tree[2].includes("├── $ pnpm test auth") && tree[2].includes("11/14") && tree[2].includes("█") && tree[2].includes("░"), `bash node with progress bar: ${tree[2]}`);
	assert(tree[3].includes("└── R refresh.test.ts") && tree[3].includes("120"), `last node closes the tree with a count: ${tree[3]}`);
	assert(tree.length === 5, "collapsed tree is head + nodes + one blank row");

	// Live capture bug: badge must close with fg+bg resets and every label needs an explicit ink fg
	// (the terminal default fg is invisible on the page bg).
	const rawTree = groups.renderChatChildren(treeChildren, 100);
	const INK_ESC = "\x1b[38;2;216;212;180m";
	assert(rawTree[3].includes(`\x1b[48;2;168;163;133m\x1b[38;2;12;12;12mR\x1b[39m\x1b[49m ${INK_ESC}refresh.test.ts\x1b[39m`), `read badge + ink label escapes: ${JSON.stringify(rawTree[3])}`);
	assert(groups.renderChatChildren(finished, 100)[0].includes(`${INK_ESC}read session.ts token.ts\x1b[39m`), "group head call text must be ink");
	const longCall = groups.renderChatChildren([tool("bash", { command: "rg -n REFRESH_TTL src/auth/session.ts src/auth/token.ts" }, { expanded: true })], 100).map(strip).find((row) => row.includes("── "));
	assert(/…\s+\S/.test(longCall) && !/…\S/.test(longCall), `truncated call cell must keep a gap before the state label: ${longCall}`);

	const expandedChildren = treeChildren.map((c) => (c.toolName ? { ...c, expanded: true, isPartial: false } : c));
	const expandedTree = groups.renderChatChildren(expandedChildren, 100).map(strip);
	const readBody = expandedTree.filter((row) => /line \d+/.test(row));
	assert(readBody.length === 50 && expandedTree.some((row) => row.includes("… 70 more lines")), `expanded read body must honor maxExpandedLines (50): got ${readBody.length}`);
	assert(!expandedTree[0].includes("^o"), "expanded head must not advertise ^o");

	// --- 7. Standalone block as the chat renders it: gutter + rail, diff rows indented under the call ---
	const spacing = await import(buildToolTags("compact-tool-spacing.js"));
	const edited = editBlockRaw({ path: "src/auth/session.ts" }, { content: [{ type: "text", text: "x" }], details: { diff: ["  19 const now = Date.now();", "-20 const exp = now + REFRESH_TTL;", "+20 const exp = now + REFRESH_TTL * 1000;", "  21 return exp;", "    ...", " 37 if (a)", "-38 old", "+38 new"].join("\n") } });
	class FakeToolExecution {
		constructor() { Object.assign(this, { toolName: "edit", result: {}, isPartial: false }); }
		render(width) { return ["", ...edited.call.render(width), ...edited.body.render(width)]; }
	}
	spacing.installCompactToolSpacing(FakeToolExecution);
	const block = new FakeToolExecution().render(WIDTH).map(strip);
	assert(block.every((row) => visibleWidth(row) === WIDTH), "standalone rows must be exactly the chat width");
	assert(block[0].startsWith("      │ › edit src/auth/session.ts") && block[0].includes("// +2 -2 · 0.1s"), `edit call row: ${block[0]}`);
	assert(block[1].startsWith("      │   ") && block[1].includes("20 - const exp"), `diff rows sit under the call, indented 2: ${block[1]}`);
	assert(block.at(-1).trim() === "│", "block must end with one blank rail row");

	// Running progress bar only for unambiguous n/m forms.
	const progressRow = (last) => groups.renderChatChildren([tool("bash", { command: "build" }, { expanded: true, isPartial: true, result: { content: [{ type: "text", text: `step\n${last}` }] } })], 100).map(strip).find((row) => row.includes("── ")) ?? "";
	for (const last of ["[37/120]", "(37/120)", "37/120 files", "37/120", "37/120 (31%)"]) assert(progressRow(last).includes("37/120") && progressRow(last).includes("█"), `"${last}" should draw a bar: ${progressRow(last)}`);
	for (const last of ["2026/10/12", "10/12 meeting", "src/1/2.ts", "see 3/4 of it"]) assert(!progressRow(last).includes("░"), `"${last}" must not draw a bar: ${progressRow(last)}`);

	// Runner summary beats the plain line count; no summary falls back to `lines N`.
	const bash = (command, text, extra = {}) => tool("bash", { command }, { expanded: true, result: { content: [{ type: "text", text }], ...extra } });
	const passRows = groups.renderChatChildren([
		bash("pnpm test", "Tests  11 passed, 3 failed, 14 total", { isError: true }),
		bash("pnpm t2", "Tests 14 passed (14)"),
		bash("ls", "a\nb"),
	], 100).map(strip).filter((row) => row.includes("── "));
	assert(passRows[0].includes("failed") && passRows[0].includes("11/14") && passRows[0].includes("█"), `failing run should show failed + n/m bar: ${passRows[0]}`);
	assert(passRows[1].includes("passed") && passRows[1].includes("14/14"), `passing run should show passed + full bar: ${passRows[1]}`);
	assert(passRows[2].includes("lines") && !passRows[2].includes("/"), `no summary falls back to the line count: ${passRows[2]}`);

	// --- 8. Terminal image lines survive the render patch; reload re-installs without stacking ---
	const kitty = "\x1b_Gf=100,t=d,a=T;QUFBQQ==\x1b\\";
	const iterm = "\x1b]1337;File=inline=1:QUFBQQ==\x07";
	class FakeImageTool {
		constructor() { Object.assign(this, { toolName: "read", result: {}, isPartial: false }); }
		render() { return ["", "› read photo.png", "", kitty, "", iterm]; }
	}
	spacing.installCompactToolSpacing(FakeImageTool);
	const imageLines = new FakeImageTool().render(80);
	assert(imageLines.includes(kitty) && imageLines.includes(iterm) && imageLines.indexOf(kitty) < imageLines.indexOf(iterm), "kitty/iTerm2 image lines must pass through untouched and in order");
	assert(imageLines[imageLines.indexOf(kitty) - 1] === "", "one spacer row must stay before the image block");
	assert(strip(imageLines[0]).startsWith("      │ › read photo.png"), `text rows around images still get gutter + rail: ${strip(imageLines[0])}`);
	const wrapped = FakeImageTool.prototype.render;
	spacing.installCompactToolSpacing(FakeImageTool);
	const reloaded = await import(`${buildToolTags("compact-tool-spacing.js")}?reload=1`);
	reloaded.installCompactToolSpacing(FakeImageTool);
	assert(FakeImageTool.prototype.render === wrapped, "re-install (same or reloaded module copy) must not stack a second render wrapper");
	assert(new FakeImageTool().render(80).filter((row) => strip(row).includes("› read photo.png")).length === 1, "re-install must not prefix rows twice");

	// Uncolored code (identifiers/operators) must fall back to ink, not the terminal default fg.
	const INK = "\x1b[38;2;216;212;180m";
	const rawDiffRow = edited.body.render(WIDTH).find((row) => strip(row).includes("const exp = now + REFRESH_TTL;"));
	assert(rawDiffRow?.includes(`const\x1b[39m${INK} exp`), `highlighted diff code must re-establish ink after fg resets: ${JSON.stringify(rawDiffRow)}`);

	for (const out of [groups.renderChatChildren(finished, 100), groups.renderChatChildren(treeChildren, 100), groups.renderChatChildren(expandedChildren, 100).slice(0, 8), new FakeToolExecution().render(WIDTH)]) console.log(out.join("\n"));
	console.log("builtin tool renderers smoke ok (7-name resolution, timing precedence, edit-only registration, edit diff rows + meta, group summary)");
}

prepareWorkDir();
try {
	compileBuiltinToolRenderers();
	await runBuiltinToolRenderersSmoke();
} finally {
	// Keep the work dir for post-mortem on failure; clean up on the happy path only.
	if (process.exitCode === undefined || process.exitCode === 0) {
		rmSync(workDir, { recursive: true, force: true });
	}
}
