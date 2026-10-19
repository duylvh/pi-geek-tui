#!/usr/bin/env node
/**
 * Pasted images as `[Image #N]` text tokens: the session-dir store (age sweep, disk-seeded ids that are
 * never reused), token resolution, the Pi `input` submit policy, the real GeekEditor (paste → token,
 * one-stroke Backspace/Delete, host history untouched), OSC 8 links in user rows, and the config off switch.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { KeybindingsManager, setKeybindings, TUI_KEYBINDINGS, visibleWidth } from "@earendil-works/pi-tui";
import { buildSmoke } from "./smoke-build.mjs";

const ENTRIES = ["editor/geek-editor.ts", "editor/image-submit.ts", "messages/user-prefix.ts"];
const failures = [];
const expect = (name, condition, detail = "") => { if (!condition) failures.push(`${name}${detail ? `: ${detail}` : ""}`); };
const plain = (text) => String(text).replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "").replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
const hostClipboardImage = (bytes = 8) => {
	const path = join(tmpdir(), `pi-clipboard-${randomUUID()}.png`);
	writeFileSync(path, Buffer.alloc(bytes, 7));
	return path;
};
const tokenOf = (text) => /\[Image #(\d+)\]/.exec(text)?.[0] ?? "";
const writeConfig = (workDir, json) => {
	mkdirSync(join(workDir, "home", ".pi", "agent"), { recursive: true });
	writeFileSync(join(workDir, "home", ".pi", "agent", "pi-geek-tui.json"), `${json}\n`);
};
const editorTheme = { borderColor: (s) => s, selectList: { selectedPrefix: (s) => s, selectedText: (s) => s, description: (s) => s, scrollInfo: (s) => s, noMatch: (s) => s } };
const makeEditor = (GeekEditor, cwd, imageStoreDir) => new GeekEditor({ requestRender() {}, terminal: { rows: 40, columns: 100 } }, editorTheme, { matches: () => false, getKeys: () => [] }, {
	cwd, imageStoreDir,
	getContextUsage: () => undefined, getModelInfo: () => undefined, getBranch: () => null, getFooterStatus: () => null, getTokenUsage: () => null,
});
setKeybindings(new KeybindingsManager(TUI_KEYBINDINGS));

const built = buildSmoke("image-attachments-smoke", ENTRIES);
writeConfig(built.workDir, '{"imageAttachments":true}');
const home = join(built.workDir, "home");

// ── store: age sweep, disk-seeded serial, registry window, link table ──
{
	const store = join(home, "unit-store");
	mkdirSync(store, { recursive: true });
	const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
	for (let i = 1; i <= 102; i++) {
		writeFileSync(join(store, `${i}.png`), Buffer.alloc(4, i));
		if (i <= 50) utimesSync(join(store, `${i}.png`), eightDaysAgo, eightDaysAgo);
	}
	const mod = await built.importFresh("editor/image-attachments.js");
	mod.setImageStoreDir(store);
	const list = new mod.ImageAttachmentList();
	expect("sweep drops files past the retention window", !existsSync(join(store, "1.png")) && !existsSync(join(store, "50.png")));
	expect("sweep keeps fresh files", existsSync(join(store, "51.png")) && existsSync(join(store, "102.png")));
	expect("registry restores the newest 16", list.count() === 16 && list.list()[0].id === "87" && list.list()[15].id === "102");
	expect("link table rebuilt from disk, swept ids unlinked", mod.getGlobalImageLink("51") === join(store, "51.png") && mod.getGlobalImageLink("1") === undefined);

	const tmp = hostClipboardImage();
	const added = list.addFromPath(tmp);
	expect("serial continues past the store (102 + 1)", added?.id === "103", added?.id);
	expect("host tmp file consumed, copy persisted", !existsSync(tmp) && added?.path === join(store, "103.png") && existsSync(added.path));
	expect("second registry (resume) sees the new paste", new mod.ImageAttachmentList().list().some((item) => item.id === "103"));

	const userDir = join(built.workDir, "Application Support");
	mkdirSync(userDir, { recursive: true });
	const userImage = join(userDir, "shot.png");
	writeFileSync(userImage, Buffer.alloc(8, 3));
	writeFileSync(join(userDir, "notes.txt"), "x");
	expect("raw, shell-escaped and quoted image paths accepted",
		mod.pastedImageFilePath(userImage) === userImage && mod.pastedImageFilePath(` ${userImage.replace(/ /g, "\\ ")} `) === userImage && mod.pastedImageFilePath(`'${userImage}'`) === userImage);
	expect("missing, multi-line and non-image pastes stay text",
		mod.pastedImageFilePath(join(userDir, "missing.png")) === null && mod.pastedImageFilePath(`${userImage}\n${userImage}`) === null && mod.pastedImageFilePath(join(userDir, "notes.txt")) === null);

	const unknown = mod.resolveImageTokens("compare [Image #103] with [Image #999] and [Image #103]", list.list());
	expect("only live tokens resolve, duplicates once", unknown.referenced.length === 1 && unknown.referenced[0].id === "103");
	expect("paths replace live tokens inline", mod.replaceImageTokensWithPaths("see [Image #103] [Image #999]", list.list()) === `see ${join(store, "103.png")} [Image #999]`);

	// Every file aged out: the newest survives, so the next process still hands out a fresh id.
	const aged = join(home, "aged-store");
	mkdirSync(aged, { recursive: true });
	const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
	for (const id of [5, 6, 7]) {
		writeFileSync(join(aged, `${id}.png`), "old");
		utimesSync(join(aged, `${id}.png`), old, old);
	}
	const fresh = await built.importFresh("editor/image-attachments.js");
	fresh.setImageStoreDir(aged);
	const agedList = new fresh.ImageAttachmentList();
	expect("aged sweep keeps only the newest", !existsSync(join(aged, "6.png")) && existsSync(join(aged, "7.png")));
	expect("ids are not reused after the sweep", agedList.addFromPath(hostClipboardImage())?.id === "8");
}

// ── submit policy (Pi `input` event) ──
const { attachEditorImages } = await built.importBuilt("editor/image-submit.js");
{
	const mod = await built.importFresh("editor/image-attachments.js");
	mod.setImageStoreDir(join(home, "submit-store"));
	const attached = new mod.ImageAttachmentList().addFromPath(hostClipboardImage(1024));
	const token = `[Image #${attached.id}]`;
	const rich = attachEditorImages(`look at ${token}`, undefined, [attached], ["text", "image"]);
	expect("image model: token kept, bytes attached", rich.action === "transform" && rich.text === `look at ${token}` && rich.images?.[0]?.data === readFileSync(attached.path).toString("base64"));
	const existing = { type: "image", data: "AAAA", mimeType: "image/png" };
	expect("images already on the input stay first", attachEditorImages(`x ${token}`, [existing], [attached], ["image"]).images?.[0] === existing);
	const textOnly = attachEditorImages(`look at ${token}`, undefined, [attached], ["text"]);
	expect("text-only model: token becomes the stored path", textOnly.text === `look at ${attached.path}` && textOnly.images === undefined);
	expect("unknown modalities degrade the same way", attachEditorImages(`x ${token}`, undefined, [attached], undefined).text === `x ${attached.path}`);
	expect("no live token or a command: continue",
		attachEditorImages("text [Image #999]", undefined, [attached], ["image"]).action === "continue" && attachEditorImages(`/model ${token}`, undefined, [attached], ["image"]).action === "continue" && attachEditorImages(`!ls ${token}`, undefined, [attached], ["image"]).action === "continue");
	rmSync(attached.path);
	expect("vanished file degrades to the path", attachEditorImages(`x ${token}`, undefined, [attached], ["image"]).images === undefined);
}

// ── the real GeekEditor ──
const { GeekEditor } = await built.importBuilt("editor/geek-editor.js");
const sessionStore = join(home, ".pi", "agent", "sessions", "--proj--", "images");
{
	const editor = makeEditor(GeekEditor, join(built.workDir, "proj"), sessionStore);
	const deliver = (text) => attachEditorImages(text, undefined, editor.getImageAttachments(), ["image"]);

	const tmp = hostClipboardImage(64);
	editor.insertTextAtCursor(tmp); // what Pi's clipboard-image branch calls
	const token = tokenOf(editor.getText());
	expect("clipboard paste inserts a token", token !== "" && editor.getText() === `${token} `, JSON.stringify(editor.getText()));
	expect("tmp file consumed into the session store", !existsSync(tmp) && existsSync(join(sessionStore, `${token.match(/\d+/)[0]}.png`)));
	const rows = editor.render(100);
	expect("token renders, raw path never does", rows.some((row) => plain(row).includes(token)) && !rows.some((row) => plain(row).includes("pi-clipboard")));
	expect("rows keep the width", rows.every((row) => visibleWidth(row) === 100 || row === ""), rows.map(visibleWidth).join(","));

	editor.handleInput("\x7f");
	expect("one Backspace removes the token and its space", editor.getText() === "", JSON.stringify(editor.getText()));

	editor.setText(`${token} tail`);
	for (let i = 0; i < 30; i++) editor.handleInput("\x1b[D");
	editor.handleInput("\x1b[3~");
	expect("Delete removes a token after the cursor", editor.getText() === "tail", JSON.stringify(editor.getText()));

	editor.setText(`broken ${token.slice(0, -1)}x`);
	for (let i = 0; i < 30; i++) editor.handleInput("\x1b[C");
	editor.handleInput("\x7f");
	expect("an edited token deletes one char at a time", editor.getText() === `broken ${token.slice(0, -1)}`, JSON.stringify(editor.getText()));

	const userFile = join(built.workDir, "Application Support", "pasted.png");
	writeFileSync(userFile, Buffer.alloc(16, 3));
	editor.setText("look ");
	editor.handleInput(`\x1b[200~${userFile.replace(/ /g, "\\ ")}\x1b[201~`);
	expect("terminal paste of an image file path becomes a token", /^look \[Image #\d+\] $/.test(editor.getText()), JSON.stringify(editor.getText()));
	expect("the user's file is copied, never deleted", existsSync(userFile));
	editor.setText("");
	editor.handleInput("\x1b[200~plain words\x1b[201~");
	expect("plain-text paste untouched", editor.getText() === "plain words");

	editor.addToHistory("an older prompt");
	editor.setText("");
	editor.handleInput("\x1b[A");
	expect("Up still recalls history", editor.getText() === "an older prompt", JSON.stringify(editor.getText()));

	editor.setText("");
	editor.insertTextAtCursor(hostClipboardImage(256));
	const second = tokenOf(editor.getText());
	const sent = deliver(`look at ${second}`);
	expect("submit attaches the image behind the token", sent.images?.length === 1);
	const replacement = makeEditor(GeekEditor, join(built.workDir, "proj"), sessionStore);
	expect("a replacement editor (resume) re-sends the older token", attachEditorImages(`again ${second}`, undefined, replacement.getImageAttachments(), ["image"]).images?.[0]?.data === sent.images?.[0]?.data);

	// History rows: the token is a Cmd+Click OSC 8 link to the stored copy.
	const core = await import("@earendil-works/pi-coding-agent");
	core.initTheme("dark");
	const { installUserMessagePrefix } = await built.importBuilt("messages/user-prefix.js");
	installUserMessagePrefix();
	const id = second.match(/\d+/)[0];
	const userRows = new core.UserMessageComponent(`look at ${second} please`).render(80);
	expect("user row links the token to the stored file", userRows.some((row) => row.includes(`\x1b]8;;file://${join(sessionStore, `${id}.png`)}\x07`)), JSON.stringify(userRows));
	expect("linked user rows keep the width", userRows.every((row) => visibleWidth(row) <= 80));
}

// ── imageAttachments:false keeps the host behavior (own module graph: the config is read once per graph) ──
{
	const off = buildSmoke("image-attachments-off-smoke", ENTRIES);
	writeConfig(off.workDir, '{"imageAttachments":false}');
	const { GeekEditor: OffEditor } = await off.importBuilt("editor/geek-editor.js");
	const offStore = join(off.workDir, "home", "store");
	const editor = makeEditor(OffEditor, off.workDir, offStore);
	const tmp = hostClipboardImage(32);
	editor.insertTextAtCursor(tmp);
	expect("off: the path is inserted as text", editor.getText() === tmp, JSON.stringify(editor.getText()));
	expect("off: tmp file left alone, no store written", existsSync(tmp) && !existsSync(offStore));
	expect("off: nothing resolves on submit", editor.getImageAttachments().length === 0);
	rmSync(tmp, { force: true });
	rmSync(off.workDir, { recursive: true, force: true });
}

rmSync(built.workDir, { recursive: true, force: true });
if (failures.length > 0) {
	console.error(`image attachments smoke FAILED (${failures.length}):\n- ${failures.join("\n- ")}`);
	process.exit(1);
}
console.log("image attachments smoke ok");
