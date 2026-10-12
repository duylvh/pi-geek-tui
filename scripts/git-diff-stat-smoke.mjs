#!/usr/bin/env node
/**
 * Git diff-stat smoke: real temp repos. Clean/non-repo -> null; modify/add/delete/untracked/binary counted
 * as files+lines; fresh repo without HEAD; timeout never throws; refresh() fires onChange once per change.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = process.cwd();
const workDir = join(repoRoot, ".pi", "git-diff-stat-smoke");
const buildDir = join(workDir, "build");
const tsc = join(repoRoot, "node_modules", "typescript", "lib", "tsc.js");

rmSync(workDir, { recursive: true, force: true });
mkdirSync(buildDir, { recursive: true });
// No Node typings are installed for this repo's own compile: stub the few ambient names the module uses.
const anchor = join(workDir, "node-stubs.d.ts");
writeFileSync(anchor, `declare module "node:child_process" { export const execFile: (...args: any[]) => any; }
declare const process: any;
declare function setTimeout(...args: any[]): any;
declare function clearTimeout(handle: any): void;
`, "utf8");
process.env.GIT_CONFIG_GLOBAL = "/dev/null";
process.env.GIT_CONFIG_SYSTEM = "/dev/null";
const build = spawnSync(process.execPath, [
	tsc, "--target", "ES2022", "--module", "NodeNext", "--moduleResolution", "NodeNext",
	"--outDir", buildDir, "--rootDir", repoRoot, "--skipLibCheck", "--noImplicitAny", "false", "--lib", "ES2022",
	anchor,
	join(repoRoot, "presentation", "git-diff-stat.ts"),
], { cwd: repoRoot, encoding: "utf8" });
if (build.status !== 0) throw new Error(`tsc failed\n${build.stdout}\n${build.stderr}`);
writeFileSync(join(buildDir, "package.json"), '{"type":"module"}\n', "utf8");
const stat = await import(pathToFileURL(join(buildDir, "presentation", "git-diff-stat.js")).href);

// The module unrefs its timers (they must never hold Pi open); keep this process alive while awaiting them.
const keepAlive = setInterval(() => {}, 1000);
const failures = [];
const expect = (name, condition) => { if (!condition) failures.push(name); };
const same = (got, want) => JSON.stringify(got) === JSON.stringify(want);
const git = (cwd, ...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, stdio: "ignore" });
const lines = (n, tag = "l") => Array.from({ length: n }, (_, i) => `${tag}${i}`).join("\n") + "\n";
const tmp = mkdtempSync(join(tmpdir(), "geek-diff-stat-"));

// Not a repo.
const plain = join(tmp, "plain");
mkdirSync(plain);
expect("non-repo -> null", (await stat.readGitDiffStat(plain)) === null);

// Committed repo: clean first, then every kind of change.
const repo = join(tmp, "repo");
mkdirSync(repo);
git(repo, "init", "-q");
writeFileSync(join(repo, "a.txt"), lines(3));
writeFileSync(join(repo, "c.txt"), lines(3, "c"));
writeFileSync(join(repo, "bin.dat"), Buffer.from([0, 1, 2, 3]));
git(repo, "add", "-A");
git(repo, "commit", "-q", "-m", "init");
expect("clean -> null", (await stat.readGitDiffStat(repo)) === null);

writeFileSync(join(repo, "a.txt"), "l0\nCHANGED\nl2\nl3\n"); // +2 -1
unlinkSync(join(repo, "c.txt")); // -3 (unstaged delete)
writeFileSync(join(repo, "d.txt"), lines(4, "d")); // +4, staged
git(repo, "add", "d.txt");
writeFileSync(join(repo, "bin.dat"), Buffer.from([0, 9, 9, 9, 9])); // binary: file only
writeFileSync(join(repo, "u1.txt"), lines(50)); // untracked: file only, no lines
writeFileSync(join(repo, "u2.txt"), "x\n");
expect("modify/add/delete/binary/untracked", same(await stat.readGitDiffStat(repo), { files: 6, added: 6, removed: 4 }));

// Fresh repo without HEAD: staged + later worktree edit of the same file count as ONE file.
const fresh = join(tmp, "fresh");
mkdirSync(fresh);
git(fresh, "init", "-q");
writeFileSync(join(fresh, "x.txt"), lines(2));
git(fresh, "add", "x.txt");
writeFileSync(join(fresh, "x.txt"), lines(3));
writeFileSync(join(fresh, "y.txt"), "y\n");
expect("no HEAD yet", same(await stat.readGitDiffStat(fresh), { files: 2, added: 3, removed: 0 }));

// Timeout path: killed git is "unknown" (undefined, keep last value), never a throw.
let timedOut;
try {
	timedOut = await stat.readGitDiffStat(repo, 1);
} catch {
	timedOut = "threw";
}
expect("timeout does not throw", timedOut !== "threw" && (timedOut === undefined || timedOut === null || typeof timedOut === "object"));

// Cache + refresh: render-safe read is null until a refresh lands; onChange fires once; same value is silent.
expect("getGitDiffStat is null before any refresh", stat.getGitDiffStat(repo) === null);
let changes = 0;
const landed = new Promise((resolve) => stat.refreshGitDiffStat(repo, () => { changes++; resolve(); }));
stat.refreshGitDiffStat(repo); // debounced into the same run
await landed;
expect("refresh fills the cache", same(stat.getGitDiffStat(repo), { files: 6, added: 6, removed: 4 }));
stat.refreshGitDiffStat(repo, () => { changes++; });
await new Promise((resolve) => setTimeout(resolve, 900));
expect("unchanged tree does not notify again", changes === 1);

clearInterval(keepAlive);
rmSync(tmp, { recursive: true, force: true });
rmSync(workDir, { recursive: true, force: true });
if (failures.length) {
	console.error(`git-diff-stat smoke FAILED (${failures.length}):\n  - ${failures.join("\n  - ")}`);
	process.exit(1);
}
console.log("git-diff-stat smoke ok");
