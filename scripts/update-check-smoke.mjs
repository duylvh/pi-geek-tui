#!/usr/bin/env node
/**
 * Update-check smoke: formatUpdateNotice wording for none / pi-only / packages-only / both,
 * and checkAvailableUpdates resolving to { packages: [] } offline without touching the network.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = process.cwd();
const workDir = join(repoRoot, ".pi", "update-check-smoke");
const buildDir = join(workDir, "build");
const tsc = join(repoRoot, "node_modules", "typescript", "lib", "tsc.js");

rmSync(workDir, { recursive: true, force: true });
mkdirSync(buildDir, { recursive: true });
// No Node typings are installed for this repo's own compile: stub the few ambient names the module uses.
const anchor = join(workDir, "node-stubs.d.ts");
writeFileSync(anchor, `declare const process: any;
declare function fetch(...args: any[]): Promise<any>;
declare const AbortSignal: any;
`, "utf8");
// Built under the repo so the compiled module resolves the real @earendil-works/pi-coding-agent from node_modules.
const build = spawnSync(process.execPath, [
	tsc, "--target", "ES2022", "--module", "NodeNext", "--moduleResolution", "NodeNext",
	"--outDir", buildDir, "--rootDir", repoRoot, "--skipLibCheck", "--noImplicitAny", "false", "--lib", "ES2022",
	anchor,
	join(repoRoot, "core", "update-check.ts"),
], { cwd: repoRoot, encoding: "utf8" });
if (build.status !== 0) throw new Error(`tsc failed\n${build.stdout}\n${build.stderr}`);
writeFileSync(join(buildDir, "package.json"), '{"type":"module"}\n', "utf8");
const { checkAvailableUpdates, formatUpdateNotice } = await import(pathToFileURL(join(buildDir, "core", "update-check.js")).href);

const failures = [];
const expect = (name, got, want) => {
	if (JSON.stringify(got) !== JSON.stringify(want)) failures.push(`${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

const piLine = "Pi 9.9.9 is available. Run pi update";
const pkgLines = ["Package updates are available. Run pi update --extensions", "- npm:foo", "- git:bar"];
expect("none", formatUpdateNotice({ packages: [] }), undefined);
expect("pi only", formatUpdateNotice({ pi: "9.9.9", packages: [] }), piLine);
expect("packages only", formatUpdateNotice({ packages: ["npm:foo", "git:bar"] }), pkgLines.join("\n"));
expect("both", formatUpdateNotice({ pi: "9.9.9", packages: ["npm:foo", "git:bar"] }), [piLine, ...pkgLines].join("\n"));

process.env.PI_OFFLINE = "1";
const realFetch = globalThis.fetch;
globalThis.fetch = () => { throw new Error("network used while PI_OFFLINE=1"); };
expect("offline", await checkAvailableUpdates(repoRoot), { packages: [] });
globalThis.fetch = realFetch;

rmSync(workDir, { recursive: true, force: true });
if (failures.length > 0) {
	console.error(failures.join("\n"));
	process.exit(1);
}
console.log("update-check smoke ok");
