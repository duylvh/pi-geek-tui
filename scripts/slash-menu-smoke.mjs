#!/usr/bin/env node
/**
 * Slash menu smoke (editor/slash-menu.ts): exact row widths, full-width backgrounds (selected row uses the
 * selected surface), truncation, scrolling window, header count, empty state. Prints the rows.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { visibleWidth } from "@earendil-works/pi-tui";

const repoRoot = process.cwd();
const workDir = join(repoRoot, ".pi", "slash-menu-smoke");
const buildDir = join(workDir, "build");
const tsc = join(repoRoot, "node_modules", "typescript", "lib", "tsc.js");

rmSync(workDir, { recursive: true, force: true });
mkdirSync(buildDir, { recursive: true });
writeFileSync(join(buildDir, "package.json"), '{"type":"module"}\n', "utf8");
const build = spawnSync(process.execPath, [
	tsc, "--target", "ES2022", "--module", "NodeNext", "--moduleResolution", "NodeNext",
	"--outDir", buildDir, "--rootDir", repoRoot, "--skipLibCheck", "--noImplicitAny", "false", "--lib", "ES2022",
	join(repoRoot, "editor", "slash-menu.ts"),
], { cwd: repoRoot, encoding: "utf8" });
if (build.status !== 0) throw new Error(`tsc failed\n${build.stdout}\n${build.stderr}`);
const { renderSlashMenu } = await import(pathToFileURL(join(buildDir, "editor", "slash-menu.js")).href);

const strip = (text) => String(text).replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
const failures = [];
const expect = (name, condition) => { if (!condition) failures.push(name); };
const PANEL_BG = "\x1b[48;2;20;20;20m";
const SEL_BG = "\x1b[48;2;32;31;27m";

const commands = [
	["/model", "change model"], ["/resume", "reopen an older session"], ["/tree", "conversation branch tree"],
	["/fork", "branch off from this turn"], ["/compact", "compress context"], ["/export", "export session to html"],
	["/reload", "reload extensions, skills and themes from disk"], ["/skill:very-long-skill-name-that-overflows", "x".repeat(300)],
].map(([value, description]) => ({ value, label: value, description }));
const model = (selected, extra = {}) => ({ items: commands, selected, maxVisible: 6, withSlash: true, ...extra });

for (const width of [120, 80, 50]) {
	const rows = renderSlashMenu(model(2), width);
	expect(`rows = header + 6 items + hint @${width}`, rows.length === 8);
	expect(`every row exactly ${width} cells`, rows.every((r) => visibleWidth(r) === width));
	expect(`prefix stays blank @${width}`, rows.every((r) => strip(r).startsWith(" ".repeat(8))));
	expect(`panel bg fills every non-selected row @${width}`, rows.every((r) => r.includes(PANEL_BG) || r.includes(SEL_BG)));
	const selectedRows = rows.filter((r) => r.includes(SEL_BG));
	expect(`exactly one selected row with the selected surface @${width}`, selectedRows.length === 1 && strip(selectedRows[0]).includes("› /tree"));
	// Background must span the whole panel: the selected row's bg run reaches the end of the line.
	expect(`selected bg spans to the right edge @${width}`, selectedRows[0].endsWith("\x1b[49m") && visibleWidth(selectedRows[0]) === width);
	expect(`no wrap/overflow: header count shown @${width}`, strip(rows[0]).trimEnd().endsWith("3/8"));
	expect(`hint row last @${width}`, strip(rows.at(-1)).trimStart().startsWith(width >= 55 ? "↑↓ select · tab fill · ↩ run · esc close" : "↑↓"));
}

// Truncation: long description and long command both end in … and never exceed the width.
const wide = renderSlashMenu(model(7), 80).map(strip);
expect("long description truncated with …", wide.some((r) => r.includes("xxxx") && r.endsWith("…")));
expect("long command truncated inside its column with …", wide.some((r) => r.includes("/skill:very-long-s…")));
expect("command column is capped at 20 cells", wide.every((r) => !r.includes("/skill:very-long-sk")));

// Scrolling window keeps the selected row visible at both ends.
for (const selected of [0, 4, 7]) {
	const rows = renderSlashMenu(model(selected), 100).map(strip);
	expect(`selected ${selected} stays visible`, rows.some((r) => r.includes(`› ${commands[selected].value.slice(0, 8)}`)));
	expect(`header counts ${selected + 1}/8`, rows[0].includes(`${selected + 1}/8`));
}
expect("window shows only maxVisible items", renderSlashMenu(model(7), 100).length === 8);

// Prefix handling and hints.
const bare = renderSlashMenu({ items: [{ value: "model", description: "d" }], selected: 0, maxVisible: 6, withSlash: true }, 60).map(strip);
expect("missing / is added while typing the command name", bare[1].includes("› /model"));
expect("hints append to the description", strip(renderSlashMenu(model(0), 100, { "/model": "now opus-5-5" })[1]).includes("change model · now opus-5-5"));

// Empty state.
const empty = renderSlashMenu({ items: [], selected: 0, maxVisible: 6, withSlash: true }, 70);
expect("empty: header, message, hint", empty.length === 3 && strip(empty[1]).includes("no matching commands") && strip(empty[0]).includes("0/0"));
expect("empty rows exact width", empty.every((r) => visibleWidth(r) === 70));

// Degenerate widths never throw or overflow.
for (const width of [0, 3, 8, 9, 12]) expect(`tiny width ${width} is safe`, renderSlashMenu(model(1), width).every((r) => visibleWidth(r) <= width));

console.log("--- slash menu @100 (selected 4) ---");
for (const row of renderSlashMenu(model(4), 100, { "/model": "now opus-5-5", "/compact": "ctx 38%" })) console.log(row);

rmSync(workDir, { recursive: true, force: true });
if (failures.length) {
	console.error(`slash-menu smoke FAILED (${failures.length}):\n  - ${failures.join("\n  - ")}`);
	process.exit(1);
}
console.log("slash-menu smoke ok");
