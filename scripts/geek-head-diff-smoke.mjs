#!/usr/bin/env node
/**
 * Input head row diff stat: `… (branch) +12 -3 ~4` from a real dirty git repo; at narrow widths the cwd path
 * gives way first while the stat (and the live state) stay whole; clean repo / null → nothing extra. Pi's own
 * status (driven through the real InteractiveMode routing) shares the head row's live slot: no standalone row.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InteractiveMode, initTheme } from "@earendil-works/pi-coding-agent";
import { Container, visibleWidth } from "@earendil-works/pi-tui";
import { buildSmoke } from "./smoke-build.mjs";

const built = buildSmoke("geek-head-diff-smoke", ["editor/geek-editor.ts", "editor/live-state.ts", "presentation/git-diff-stat.ts", "presentation/geek-head.ts"]);
const { GeekEditor } = await built.importBuilt("editor/geek-editor.js");
const { setLiveState } = await built.importBuilt("editor/live-state.js");
const { refreshGitDiffStat, getGitDiffStat } = await built.importBuilt("presentation/git-diff-stat.js");
const { createGitBranchFetcher } = await built.importBuilt("presentation/geek-head.js");
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

// Pi's statuses ride the head row's live slot. Real InteractiveMode routing methods run against a minimal host; only the
// non-working indicators are stubs (the retry/compaction/branchSummary classes are not exported by the host package).
initTheme("dark"); // the host reads its theme for the stock working row
const P = InteractiveMode.prototype;
const hostFor = (editor) => {
	const host = {
		editor, defaultEditor: { setWorkingStatusIndicator() {} }, statusContainer: new Container(), idleStatus: {},
		ui: { requestRender() {}, getClearOnShrink: () => false }, options: { tuiMode: "regular" },
		session: { isStreaming: true, thinkingLevel: "off" }, defaultWorkingMessage: "Working...", workingVisible: true,
		activeStatusIndicator: undefined, activeWorkingIndicatorEmbedded: false,
	};
	for (const name of ["setEditorWorkingStatusIndicator", "showStatusIndicator", "clearStatusIndicator", "showWorkingStatusIndicator", "setWorkingVisible"]) host[name] = P[name].bind(host);
	return host;
};
const hostStatus = (kind, text) => ({ kind, renderInBorder: (width) => `\x1b[33m${text.slice(0, width)}\x1b[39m`, dispose() {} });
const heads = (editor, width) => [editor.render(width)[0], editor.renderChrome(width)[0]];
const status = editorFor(repo);
const host = hostFor(status);
setLiveState("thinking");

host.setWorkingVisible(true);
expect("working: the host keeps Pi's own working row out of the status container", host.statusContainer.children.length === 0, String(host.statusContainer.children.length));
expect("working: the host did route a working indicator to the editor", host.activeStatusIndicator?.kind === "working");
for (const [name, line] of Object.entries({ render: heads(status, 100)[0], renderChrome: heads(status, 100)[1] })) {
	row = strip(line);
	expect(`working (${name}): the head keeps the custom state`, /\S{8} · \d+\.\ds$/.test(row) && !row.includes("Working"), JSON.stringify(row));
}

for (const [kind, text] of [["retry", "Retrying (2/3) in 4s... (esc to cancel)"], ["compaction", "Auto-compacting... (esc to cancel)"], ["branchSummary", "Summarizing branch... (esc to cancel)"]]) {
	host.showStatusIndicator(hostStatus(kind, text));
	expect(`${kind}: no standalone row`, host.statusContainer.children.length === 0);
	for (const width of [120, 80, 50, 30]) {
		heads(status, width).forEach((line, index) => {
			const via = index === 0 ? "render" : "renderChrome";
			row = strip(line);
			expect(`${kind} @${width} (${via}): exactly ${width} cells`, visibleWidth(line) === width, String(visibleWidth(line)));
			expect(`${kind} @${width} (${via}): shown in place of the live state`, row.includes(text.slice(0, 10)) && !/thinking · /.test(row), JSON.stringify(row));
		});
	}
	expect(`${kind} @120: whole text shown, user@project kept`, strip(head(status, 120)).includes(text) && strip(head(status, 120)).includes("@kpi-api-service"), JSON.stringify(strip(head(status, 120))));
}

const reattached = editorFor(repo);
host.editor = reattached;
host.setEditorWorkingStatusIndicator(host.activeStatusIndicator);
expect("editor swap: the active status follows to the new editor", strip(head(reattached, 120)).includes("Summarizing branch..."), JSON.stringify(strip(head(reattached, 120))));

host.clearStatusIndicator();
row = strip(head(reattached, 100));
expect("cleared: the custom live state returns", /\S{8} · \d+\.\ds$/.test(row) && !row.includes("Summarizing"), JSON.stringify(row));
setLiveState(undefined);
row = strip(head(reattached, 100));
expect("cleared + idle: nothing on the right", row.endsWith(`~${stat.files}`) && !row.includes("Summarizing"), JSON.stringify(row));
host.activeStatusIndicator?.dispose();

const cleanRow = strip(head(editorFor(clean), 120));
expect("clean repo: nothing after the branch", /\(main\)\s*$/.test(cleanRow), JSON.stringify(cleanRow));

// Branch provider (the same `.git/HEAD` read as the transcript heads): branch, worktree, detached, non-repo.
expect("branch: main in a normal repo", createGitBranchFetcher(repo)()?.branch === "main", JSON.stringify(createGitBranchFetcher(repo)()));
const worktree = join(built.workDir, "wt-feature");
git(repo, "worktree", "add", "-q", "-b", "feat/x", worktree);
expect("branch: a worktree (`.git` is a `gitdir:` file) shows its own branch", createGitBranchFetcher(worktree)()?.branch === "feat/x", JSON.stringify(createGitBranchFetcher(worktree)()));
const detached = join(built.workDir, "wt-detached");
git(repo, "worktree", "add", "-q", "--detach", detached);
const sha = git(repo, "rev-parse", "HEAD").toString().trim().slice(0, 7);
const detachedEditor = new GeekEditor({ requestRender() {}, terminal: { rows: 40, columns: 120 } }, editorTheme, { matches: () => false, getKeys: () => [] }, {
	cwd: detached, getContextUsage: () => undefined, getModelInfo: () => undefined, getBranch: createGitBranchFetcher(detached), getFooterStatus: () => null, getTokenUsage: () => null,
});
const detachedRow = strip(head(detachedEditor, 120));
expect("detached HEAD: the input head shows the short sha", detachedRow.includes(`(${sha})`), JSON.stringify(detachedRow));
const outside = mkdtempSync(join(tmpdir(), "geek-no-repo-"));
let noRepo;
expect("non-repo: no branch, no throw", (() => { noRepo = createGitBranchFetcher(outside)(); return noRepo === null; })(), JSON.stringify(noRepo));
rmSync(outside, { recursive: true, force: true });

console.log(strip(head(dirty, 120)));
console.log(strip(head(dirty, 60)));
rmSync(built.workDir, { recursive: true, force: true });
if (failures.length) {
	console.error(`geek head diff smoke FAILED (${failures.length}):\n- ${failures.join("\n- ")}`);
	process.exit(1);
}
console.log("geek head diff smoke ok");
