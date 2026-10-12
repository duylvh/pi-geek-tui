#!/usr/bin/env node
/**
 * Slash popup placement in the real GeekEditor: panel rows sit ABOVE the input head row (transcript → menu →
 * head → input → rule → footer), every row is exactly the width, live hints reach the descriptions, and
 * nothing is shown when no slash autocomplete is active. (renderSlashMenu itself: slash-menu-smoke.)
 */
import { join } from "node:path";
import { rmSync } from "node:fs";
import { visibleWidth } from "@earendil-works/pi-tui";
import { buildSmoke } from "./smoke-build.mjs";

const built = buildSmoke("geek-slash-editor-smoke", ["editor/geek-editor.ts", "editor/live-state.ts"]);
const { GeekEditor } = await built.importBuilt("editor/geek-editor.js");
const { GEEK_PREFIX_WIDTH: P } = await built.importBuilt("presentation/geek-rows.js");
const strip = (text) => String(text).replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
const failures = [];
const expect = (name, condition, detail = "") => { if (!condition) failures.push(`${name}${detail ? `: ${detail}` : ""}`); };

const editorTheme = { borderColor: (s) => s, selectList: { selectedPrefix: (s) => s, selectedText: (s) => s, description: (s) => s, scrollInfo: (s) => s, noMatch: (s) => s } };
const editor = new GeekEditor({ requestRender() {}, terminal: { rows: 40, columns: 100 } }, editorTheme, { matches: () => false, getKeys: () => [] }, {
	cwd: join(built.workDir, "proj"),
	getContextUsage: () => ({ tokens: 62800, percent: 31.4, contextWindow: 200000 }),
	getModelInfo: () => ({ provider: "anthropic", id: "claude-opus-5-5", reasoning: true, thinkingLevel: "high" }),
	getBranch: () => ({ branch: "main" }), getFooterStatus: () => null, getTokenUsage: () => null,
});
const items = [
	{ value: "model", label: "model", description: "Select model" },
	{ value: "compact", label: "compact", description: "Compact the context" },
	{ value: "copy", label: "copy", description: "Copy last message" },
];

const idleRows = editor.render(100).map(strip);
const headIndex = (rows) => rows.findIndex((row) => row.startsWith(`${" ".repeat(P - 2)}• `));
expect("idle: no menu, head row first", headIndex(idleRows) === 0, JSON.stringify(idleRows.slice(0, 3)));

editor.setText("/");
editor.autocompleteState = "regular";
// Pi's own render asks the list for its rows (the editor replaces them); the model fields are what we read.
editor.autocompleteList = { filteredItems: items, selectedIndex: 1, maxVisible: 6, render: () => items.map((item) => `  ${item.label}`) };
const all = editor.render(100);
const rows = all.map(strip);
const head = headIndex(rows);
expect("menu rows come before the head row", head > 0, String(head));
expect("menu lists the commands above the head", rows.slice(0, head).some((r) => r.includes("/model")) && rows.slice(0, head).some((r) => r.includes("/compact")), JSON.stringify(rows.slice(0, head)));
expect("input row stays right under the head", new RegExp(`^ {${P}}› /`).test(rows[head + 1]), JSON.stringify(rows[head + 1]));
expect("live hints are appended", rows.slice(0, head).join("\n").includes("now claude-opus-5-5") && rows.slice(0, head).join("\n").includes("ctx 31%"), JSON.stringify(rows.slice(0, head)));
expect("no menu rows below the input", !rows.slice(head + 2).some((r) => r.includes("/copy")));
expect("every row exactly the width", all.every((row) => visibleWidth(row) === 100 || row === ""), all.map(visibleWidth).join(","));

editor.autocompleteState = undefined;
editor.autocompleteList = undefined;
expect("menu disappears with the autocomplete", headIndex(editor.render(100).map(strip)) === 0);

console.log(rows.join("\n"));
rmSync(built.workDir, { recursive: true, force: true });
if (failures.length) {
	console.error(`geek slash editor smoke FAILED (${failures.length}):\n- ${failures.join("\n- ")}`);
	process.exit(1);
}
console.log("geek slash editor smoke ok");
