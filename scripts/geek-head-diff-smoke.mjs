#!/usr/bin/env node
/**
 * Input head row diff stat: `… (branch) +12 -3 ~4` from a real dirty git repo; at narrow widths the cwd path
 * gives way first while the stat (and the live state) stay whole; clean repo / null → nothing extra.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { visibleWidth } from "@earendil-works/pi-tui";
import { buildSmoke } from "./smoke-build.mjs";

const built = buildSmoke("geek-head-diff-smoke", ["editor/geek-editor.ts", "editor/live-state.ts", "presentation/git-diff-stat.ts"]);
const { GeekEditor } = await built.importBuilt("editor/geek-editor.js");
const { setLiveState } = await built.importBuilt("editor/live-state.js");
const { refreshGitDiffStat, getGitDiffStat } = await built.importBuilt("presentation/git-diff-stat.js");
const strip = (text) => String(text).replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
const failures = [];
const expect = (name, condition, detail = "") => { if (!condition) failures.push(`${name}${detail ? `: ${detail}` : ""}`); };

const git = (cwd, ...args) => execFileSync("git", args, { cwd, stdio: "pipe" });
const repo = join(built.workDir, "some", "deeply", "nested", "kpi-api-service");
mkdirSync(repo, { recursive: true });
git(repo, "init", "-q", "-b", "main");
git(repo, "config", "user.email", "t@t"); git(repo, "config", "user.name", "t");
writeFileSync(join(repo, "a.txt"), "1\n2\n3\n4\n5\n");
writeFileSync(join(repo, "b.txt"), "x\n");
git(repo, "add", "."); git(repo, "commit", "-qm", "init");
writeFileSync(join(repo, "a.txt"), "1\n2\nCHANGED\n4\n5\nnew1\nnew2\n"); // +3 -1
writeFileSync(join(repo, "c.txt"), "untracked\n"); // +1, one more file
const clean = join(built.workDir, "clean");
mkdirSync(clean, { recursive: true });
git(clean, "init", "-q", "-b", "main");

// The provider's debounce timer is unref'd (it must never keep Pi alive), so hold the loop open while waiting.
const waitFor = (cwd) => new Promise((resolve) => {
	const hold = setInterval(() => {}, 50);
	refreshGitDiffStat(cwd, () => { clearInterval(hold); resolve(); });
});
await waitFor(repo);
const stat = getGitDiffStat(repo);
expect("provider sees the dirty repo", stat && stat.files === 2 && stat.added > 0 && stat.removed === 1, JSON.stringify(stat));

const editorTheme = { borderColor: (s) => s, selectList: { selectedPrefix: (s) => s, selectedText: (s) => s, description: (s) => s, scrollInfo: (s) => s, noMatch: (s) => s } };
const editorFor = (cwd) => new GeekEditor({ requestRender() {}, terminal: { rows: 40, columns: 120 } }, editorTheme, { matches: () => false, getKeys: () => [] }, {
	cwd, getContextUsage: () => undefined, getModelInfo: () => undefined, getBranch: () => ({ branch: "main" }), getFooterStatus: () => null, getTokenUsage: () => null,
});
const head = (editor, width) => editor.render(width)[0];
const dirty = editorFor(repo);
const STAT = new RegExp(`\\(main\\) \\+${stat.added} -${stat.removed} ~${stat.files}`);

let row = strip(head(dirty, 120));
expect("wide: path, branch, then +added -removed ~files", row.includes("kpi-api-service") && STAT.test(row), JSON.stringify(row));
const raw = head(dirty, 120);
// Input head matches the transcript heads: bold ink name, faint context, stat colors untouched.
expect("name bold ink, @host/branch faint", /\x1b\[1m\x1b\[38;2;216;212;180m[^\x1b]+\x1b\[39m\x1b\[22m\x1b\[38;2;82;91;84m@kpi-api-service/.test(raw) && raw.includes("\x1b[38;2;82;91;84m(main)"), JSON.stringify(raw));
expect("colors: + mono, - delMark, ~ dim", raw.includes(`38;2;136;198;163m+${stat.added}`) && raw.includes(`38;2;221;86;112m-${stat.removed}`) && raw.includes(`38;2;168;163;133m~${stat.files}`));

for (const width of [100, 70, 50]) {
	row = strip(head(dirty, width));
	expect(`@${width}: head exactly ${width} cells`, visibleWidth(head(dirty, width)) === width, String(visibleWidth(head(dirty, width))));
	expect(`@${width}: stat stays whole`, STAT.test(row) || row.includes(`+${stat.added} -${stat.removed} ~${stat.files}`), JSON.stringify(row));
	expect(`@${width}: user@project and branch stay`, row.includes("@kpi-api-service") && row.includes("(main)"), JSON.stringify(row));
}
for (const width of [40, 30]) expect(`@${width}: even when nothing fits the row is exactly ${width} cells`, visibleWidth(head(dirty, width)) === width);
const narrow = strip(head(dirty, 56));
expect("narrow: path truncated from the left (keeps its tail), not the stat", /…|^ {6}• /.test(narrow) && narrow.includes(`~${stat.files}`) && !narrow.includes("some/deeply"), JSON.stringify(narrow));

// live state + stat together at a width where the path must give way
setLiveState("thinking");
head(dirty, 80); // starts the decode-in of the word
const realNow = Date.now;
Date.now = () => realNow() + 1000;
row = strip(head(dirty, 80));
Date.now = realNow;
expect("live state and stat both stay at 80", /\S{8} · \d+\.\ds$/.test(row) && row.includes(`~${stat.files}`), JSON.stringify(row));
setLiveState(undefined);

const cleanRow = strip(head(editorFor(clean), 120));
expect("clean repo: nothing after the branch", /\(main\)\s*$/.test(cleanRow), JSON.stringify(cleanRow));

console.log(strip(head(dirty, 120)));
console.log(strip(head(dirty, 60)));
rmSync(built.workDir, { recursive: true, force: true });
if (failures.length) {
	console.error(`geek head diff smoke FAILED (${failures.length}):\n- ${failures.join("\n- ")}`);
	process.exit(1);
}
console.log("geek head diff smoke ok");
