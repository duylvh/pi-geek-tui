#!/usr/bin/env node
/**
 * Editor slot frame: every selector/dialog Pi puts in the editor slot (real Pi components, swapped in by
 * Pi's real InteractiveMode.setCustomEditorComponent) renders exactly `width` cells, behind an 8-cell blank
 * prefix, with no stock border strokes; our own editor passes through untouched.
 */
import { rmSync } from "node:fs";
import { visibleWidth } from "@earendil-works/pi-tui";
import { buildSmoke } from "./smoke-build.mjs";

const built = buildSmoke("geek-slot-frame-smoke", ["editor/slot-frame.ts"]);
const { installEditorSlotFrame, OWN_EDITOR_ROWS } = await built.importBuilt("editor/slot-frame.js");
const core = await import("@earendil-works/pi-coding-agent");
core.initTheme("dark");
const corePiTui = new URL("../node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-tui/dist/index.js", import.meta.url).href;
const { Container } = await import(corePiTui).catch(() => import("@earendil-works/pi-tui"));

const strip = (text) => String(text).replace(/\x1b\][^\x07]*\x07/g, "").replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
const failures = [];
const expect = (name, condition, detail = "") => { if (!condition) failures.push(`${name}${detail ? `: ${detail}` : ""}`); };

// Pi's real swap method on a stand-in `this` (the editor factory returns our marked editor).
class OwnEditor { render(width) { return ["      • bean@proj".padEnd(width)]; } setText() {} getText() { return ""; } }
OwnEditor.prototype[OWN_EDITOR_ROWS] = true;
installEditorSlotFrame(core.InteractiveMode);
const mode = {
	editorContainer: new Container(),
	editor: new OwnEditor(),
	defaultEditor: { onSubmit() {}, onChange() {}, getPaddingX: () => 0, actionHandlers: new Map() },
	ui: { setFocus() {}, requestRender() {} },
	keybindings: {},
};
core.InteractiveMode.prototype.setCustomEditorComponent.call(mode, () => new OwnEditor());
const container = mode.editorContainer;
expect("own editor passes through untouched", container.render(80)[0] === "      • bean@proj".padEnd(80));

const long = "a very long option text that goes on and on and on for far more than any terminal width could ever hold ".repeat(2);
const selectors = {
	extSelect: () => new core.ExtensionSelectorComponent("Pick " + long, [long, "short", "Another " + long], () => {}, () => {}),
	extInput: () => new core.ExtensionInputComponent("Enter value " + long, undefined, () => {}, () => {}),
	theme: () => new core.ThemeSelectorComponent("dark", () => {}, () => {}, () => {}),
	thinking: () => new core.ThinkingSelectorComponent("high", ["off", "low", "high"], () => {}, () => {}),
	userMsg: () => new core.UserMessageSelectorComponent([{ id: "1", text: long, timestamp: "2026-01-01" }], () => {}, () => {}),
};
const swapIn = (component) => { container.clear(); container.addChild(component); };
for (const width of [112, 62, 30]) {
	for (const [name, make] of Object.entries(selectors)) {
		swapIn(make());
		const rows = container.render(width);
		expect(`${name}@${width}: every row exactly ${width} cells`, rows.every((row) => visibleWidth(row) === width), JSON.stringify(rows.map(visibleWidth)));
		expect(`${name}@${width}: 8 blank prefix cells`, rows.every((row) => strip(row).slice(0, 8).trim() === ""));
		expect(`${name}@${width}: no stock border strokes`, !rows.some((row) => /─{3,}/.test(strip(row))));
	}
}
swapIn(selectors.extSelect());
const marked = container.render(80).map(strip).join("\n");
expect("selection marker is the geek `›`", /^ {8} *› /m.test(marked) && !marked.includes("→"), marked);
const panel = container.render(80)[3];
expect("rows sit on the panel background", panel.includes("48;2;20;20;20"));

container.clear();
container.addChild(new OwnEditor());
expect("Esc path: back to the editor, rows unframed again", container.render(80)[0] === "      • bean@proj".padEnd(80));

console.log(strip(container.children.length ? "" : ""), (swapIn(selectors.theme()), container.render(60).map(strip).join("\n")));
rmSync(built.workDir, { recursive: true, force: true });
if (failures.length) {
	console.error(`geek slot frame smoke FAILED (${failures.length}):\n- ${failures.join("\n- ")}`);
	process.exit(1);
}
console.log("geek slot frame smoke ok");
