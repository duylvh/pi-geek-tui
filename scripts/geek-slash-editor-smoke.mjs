#!/usr/bin/env node
/**
 * Slash popup placement in the real GeekEditor: panel rows sit ABOVE the input head row (transcript → menu →
 * head → input → rule → footer), every row is exactly the width, live hints reach the descriptions, and
 * nothing is shown when no slash autocomplete is active. In fullscreen (Pi's real TuiAltScreen) the same panel
 * floats over the transcript instead, and opening it moves no other screen row. (renderSlashMenu itself: slash-menu-smoke.)
 */
import { join } from "node:path";
import { rmSync } from "node:fs";
import { Container, HStack, ScrollView, SelectList, TuiAltScreen, VStack, visibleWidth } from "@earendil-works/pi-tui";
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

// Pi clears the autocomplete asynchronously: for a frame the text is already empty but the slash list is still set.
{
	const listOf = (rows) => ({ filteredItems: rows, selectedIndex: 0, maxVisible: 6, render: () => rows.map((item) => `  ${item.label}`) });
	const slashList = listOf(items);
	editor.setText("/");
	editor.autocompleteState = "regular";
	editor.autocompleteList = slashList;
	editor.render(100);
	editor.setText("");
	editor.autocompleteState = "regular";
	editor.autocompleteList = slashList;
	const stale = editor.render(100).map(strip);
	expect("closing slash menu: Pi's stale list rows are not drawn below the input", headIndex(stale) === 0 && !stale.some((r) => r.includes("model")), JSON.stringify(stale));
	editor.autocompleteList = listOf([{ value: "src/", label: "src/", description: "" }]);
	const files = editor.render(100).map(strip);
	expect("a new non-slash list below the input is still drawn", files.some((r) => r.includes("src/")), JSON.stringify(files));
	editor.autocompleteState = undefined;
	editor.autocompleteList = undefined;
	editor.render(100);
}

// Mouse: Pi hit-tests ITS editor layout; GeekEditor translates ours (menu above the head, no borders).
{
	const many = Array.from({ length: 20 }, (_, i) => ({ value: `cmd${String(i).padStart(2, "0")}`, label: `cmd${String(i).padStart(2, "0")}`, description: `command ${i}` }));
	const open = (selected) => {
		editor.setText("/");
		editor.autocompleteState = "regular";
		editor.autocompleteList = new SelectList(many, 5, editorTheme.selectList);
		editor.autocompleteList.setSelectedIndex(selected);
		return editor.render(100).map(strip);
	};
	const marked = (rows) => rows.slice(0, headIndex(rows)).find((r) => r.slice(P).trimStart().startsWith("› "))?.slice(P).trim().split(/\s+/)[1];
	// Click each item row of a scrolled window: the clicked command is selected, marked, and is what Enter/onSelect runs.
	for (const k of [1, 2, 3, 4, 5]) {
		const rows = open(9);
		const shown = rows[k].slice(P).replace("›", " ").trim().split(/\s+/)[0];
		let chosen;
		editor.autocompleteList.onSelect = (item) => { chosen = item; };
		editor.handleMouse({ type: "press", button: "left", x: 20, y: k, width: 100, height: rows.length });
		const after = editor.render(100).map(strip);
		expect(`press on item row ${k} selects the row's command (${shown})`, `/${editor.autocompleteList.getSelectedItem()?.value}` === shown && marked(after) === shown, `${editor.autocompleteList.getSelectedItem()?.value} marked ${marked(after)}`);
		editor.handleMouse({ type: "click", button: "left", x: 20, y: k, width: 100, height: rows.length });
		expect(`click on item row ${k} runs the row's command`, `/${chosen?.value}` === shown, String(chosen?.value));
	}
	// Wheel over ANY menu row (header, items, hint) moves the selection; the window follows and keeps it marked.
	{
		const rows = open(0);
		const menuRows = headIndex(rows);
		for (let y = 0; y < menuRows; y++) {
			const before = editor.autocompleteList.selectedIndex;
			editor.handleMouse({ type: "wheel", wheelDelta: 1, x: 20, y, width: 100, height: rows.length });
			const after = editor.render(100).map(strip);
			expect(`wheel down on menu row ${y} moves the selection by one`, editor.autocompleteList.selectedIndex === before + 1, `${before} -> ${editor.autocompleteList.selectedIndex}`);
			expect(`after wheel on row ${y} the selected command is marked`, marked(after) === `/${editor.autocompleteList.getSelectedItem()?.value}`, String(marked(after)));
		}
	}
	// Rows under the menu (head, input, rule, statusline) never reach the list.
	{
		const rows = open(4);
		for (let y = headIndex(rows); y < rows.length; y++) {
			editor.handleMouse({ type: "wheel", wheelDelta: 1, x: 20, y, width: 100, height: rows.length });
			editor.handleMouse({ type: "press", button: "left", x: 20, y, width: 100, height: rows.length });
		}
		expect("events below the menu leave the selection alone", editor.autocompleteList.selectedIndex === 4, String(editor.autocompleteList.selectedIndex));
	}
	editor.autocompleteState = undefined;
	editor.autocompleteList = undefined;
}

// An inline `/token` after text opens the slash menu only for regular completion; Tab-forced path completion stays in Pi's list.
{
	const aboveHead = (state, list) => {
		editor.setText("fix /co");
		editor.autocompleteState = state;
		editor.autocompleteList = list;
		const rows = editor.render(100).map(strip);
		return rows.slice(0, headIndex(rows));
	};
	const inline = aboveHead("regular", { filteredItems: items, selectedIndex: 1, maxVisible: 6, render: () => items.map((item) => `  ${item.label}`) });
	expect("inline /co with regular completion shows menu rows listing /compact", inline.length > 0 && inline.some((r) => r.includes("/compact")), JSON.stringify(inline));
	const files = [{ value: "/Users/", label: "Users/" }];
	const forced = aboveHead("force", { filteredItems: files, selectedIndex: 0, maxVisible: 6, render: () => files.map((item) => `  ${item.label}`) });
	expect("inline /co with forced path completion shows no menu", forced.length === 0, JSON.stringify(forced));
	editor.autocompleteState = undefined;
	editor.autocompleteList = undefined;
	editor.setText("");
}

// Click inside the input text puts Pi's cursor under the clicked cell (x shifted past rail + prompt).
{
	const clickAt = (text, row, col) => {
		editor.setText(text);
		const all = editor.render(100).map(strip);
		const head = headIndex(all);
		editor.handleMouse({ type: "click", button: "left", x: P + 2 + col, y: head + row, width: 100, height: all.length });
		return editor.getCursor();
	};
	const one = clickAt("hello world again", 1, 6);
	expect("click on col 6 of the input puts the cursor at col 6", one.line === 0 && one.col === 6, JSON.stringify(one));
	const two = clickAt("first line\nsecond", 2, 3);
	expect("click on row 2 col 3 of a multi-line input puts the cursor at line 1 col 3", two.line === 1 && two.col === 3, JSON.stringify(two));
	const rail = clickAt("hello", 1, -4);
	expect("click on the rail/prompt cells clamps to col 0", rail.line === 0 && rail.col === 0, JSON.stringify(rail));
	editor.setText("");
}

// The cursor block never lands in the last column: Rex stretches that cell's background across the window padding.
{
	const blockColumns = [];
	for (let length = 90; length <= 100; length++) {
		editor.setText("x".repeat(length));
		for (const row of editor.render(100)) {
			const block = row.indexOf("\x1b[48;2;");
			if (block >= 0) blockColumns.push(visibleWidth(strip(row.slice(0, block))));
		}
	}
	expect("the cursor block stays left of the last column", blockColumns.length === 11 && Math.max(...blockColumns) < 99, JSON.stringify(blockColumns));
	editor.setText("");
}

// Fullscreen: Pi's real alt-screen renderer, laid out like Pi's chat viewport (transcript, then a dock with the
// editor slot and a row below it), the dock behind a 4-cell gutter. The panel covers the transcript rows right
// above the head row, in the editor's columns.
{
	const terminal = { columns: 100, rows: 30, write() {}, hideCursor() {}, showCursor() {}, start() {}, stop() {} };
	const tui = new TuiAltScreen(terminal, false);
	tui.altScreenActive = true;
	const fsEditor = new GeekEditor(tui, editorTheme, { matches: () => false, getKeys: () => [] }, {
		cwd: join(built.workDir, "proj"), getContextUsage: () => undefined, getModelInfo: () => undefined,
		getBranch: () => null, getFooterStatus: () => null, getTokenUsage: () => null,
	});
	const transcript = { render: () => Array.from({ length: 60 }, (_, i) => `message ${i}`), invalidate() {} };
	const slot = new Container();
	slot.addChild(fsEditor);
	tui.setLayoutRoot(new VStack([
		{ component: new ScrollView(transcript, { follow: "end", primary: true }), basis: 0, grow: 1, shrink: 1, minSize: 1 },
		{ component: new HStack([
			{ component: { render: () => [], invalidate() {} }, basis: 4, minSize: 4, maxSize: 4 },
			{ component: new VStack([{ component: slot, shrink: 1, minSize: 3 }, { component: { render: () => ["row below the editor"], invalidate() {} }, shrink: 1, minSize: 0 }]), basis: 0, grow: 1, shrink: 1, minSize: 1 },
		], { align: "stretch" }), basis: "auto", grow: 0, shrink: 1, minSize: 1 },
	]));
	tui.setFocus(fsEditor);
	const screen = () => {
		tui.doRender();
		return tui.getScreenLines().map((line) => strip(line.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")));
	};
	const open = () => {
		fsEditor.autocompleteState = "regular";
		fsEditor.autocompleteList = new SelectList(items, 5, editorTheme.selectList);
		fsEditor.autocompleteList.setSelectedIndex(1);
	};
	const close = () => {
		fsEditor.autocompleteState = undefined;
		fsEditor.autocompleteList = undefined;
	};

	fsEditor.setText("/");
	screen();
	const closed = screen();
	open();
	const opened = screen();
	const head = closed.findIndex((row) => row.slice(4).startsWith(`${" ".repeat(P - 2)}• `));
	const panel = opened.slice(head - 5, head);
	expect("fullscreen: the editor head row stays on the same screen row", head > 5 && opened[head] === closed[head], JSON.stringify(opened[head]));
	expect("fullscreen: the panel's five rows sit right above the head row and list the commands",
		panel[0].includes("commands") && panel[1].includes("/model") && panel[2].includes("› /compact") && panel[3].includes("/copy") && panel[4].includes("select"),
		JSON.stringify(panel));
	expect("fullscreen: the panel starts at the editor's column (the gutter cells still show the transcript)", panel.every((row) => row.startsWith("mess") && row.length === 100), JSON.stringify(panel));
	const moved = opened.map((row, i) => (i >= head - 5 && i < head) || row === closed[i] ? -1 : i).filter((i) => i >= 0);
	expect("fullscreen: every row outside the panel is unchanged (transcript, editor, row below)", moved.length === 0, JSON.stringify(moved.map((i) => [closed[i], opened[i]])));
	expect("fullscreen: the editor itself returns no menu rows", headIndex(fsEditor.render(100).map(strip)) === 0);

	// Mouse goes through Pi's SGR input path: press + release on an item row is a click, the wheel moves the selection.
	let chosen;
	fsEditor.autocompleteList.onSelect = (item) => { chosen = item; };
	const sgr = (button, x, y, end = "M") => tui.handleTerminalInput(`\x1b[<${button};${x + 1};${y + 1}${end}`);
	sgr(0, 20, head - 2);
	sgr(0, 20, head - 2, "m");
	expect("fullscreen: a click on an item row runs that row's command", chosen?.value === "copy", String(chosen?.value));
	expect("fullscreen: the clicked row is marked in the next frame", screen()[head - 2].includes("› /copy"));
	sgr(64, 20, head - 5);
	expect("fullscreen: the wheel over the panel header moves the selection", fsEditor.autocompleteList.selectedIndex === 1, String(fsEditor.autocompleteList.selectedIndex));
	expect("fullscreen: the keyboard stays with the editor after panel clicks", tui.getFocusedComponent() === fsEditor);

	close();
	const reclosed = screen();
	expect("fullscreen: closing the menu restores the exact closed screen", JSON.stringify(reclosed) === JSON.stringify(closed), JSON.stringify(reclosed.slice(head - 5, head)));
	expect("fullscreen: no overlay entry stays behind, so Pi can still switch TUI mode", !tui.hasOverlayEntries);

	// Pi swaps the slot's child for a selector or a new editor (/reload) without telling the old editor.
	open();
	screen();
	slot.clear();
	slot.addChild({ render: () => ["selector"], invalidate() {} });
	const replaced = screen();
	expect("fullscreen: a replaced editor's panel disappears", !replaced.some((row) => row.includes("commands")) && !tui.hasOverlayEntries, JSON.stringify(replaced.slice(-8)));
	close();
}

console.log(rows.join("\n"));
rmSync(built.workDir, { recursive: true, force: true });
if (failures.length) {
	console.error(`geek slash editor smoke FAILED (${failures.length}):\n- ${failures.join("\n- ")}`);
	process.exit(1);
}
console.log("geek slash editor smoke ok");
