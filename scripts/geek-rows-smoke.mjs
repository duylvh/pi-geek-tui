#!/usr/bin/env node
/**
 * Row grammar smoke: every helper in presentation/geek-rows.ts must emit exact visible widths
 * (ANSI-safe) and print real sample rows for eyeballing.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { visibleWidth } from "@earendil-works/pi-tui";

const repoRoot = process.cwd();
const workDir = join(repoRoot, ".pi", "geek-rows-smoke");
const buildDir = join(workDir, "build");
const tsc = join(repoRoot, "node_modules", "typescript", "lib", "tsc.js");

rmSync(workDir, { recursive: true, force: true });
mkdirSync(buildDir, { recursive: true });
writeFileSync(join(buildDir, "package.json"), '{"type":"module"}\n', "utf8");
const build = spawnSync(process.execPath, [
	tsc, "--target", "ES2022", "--module", "NodeNext", "--moduleResolution", "NodeNext",
	"--outDir", buildDir, "--rootDir", repoRoot, "--skipLibCheck", "--noImplicitAny", "false", "--lib", "ES2022",
	join(repoRoot, "presentation", "geek-rows.ts"),
], { cwd: repoRoot, encoding: "utf8" });
if (build.status !== 0) throw new Error(`tsc failed\n${build.stdout}\n${build.stderr}`);

const rows = await import(pathToFileURL(join(buildDir, "presentation", "geek-rows.js")).href);
const strip = (text) => String(text).replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
const failures = [];
const expect = (name, condition) => { if (!condition) failures.push(name); };

for (const width of [20, 40, 80]) {
	const head = rows.geekHeadBody({ name: "bean", host: "kpi-api", cwd: "~/code/kpi-api", branch: "fix/refresh-ttl" });
	for (const rail of ["head-user", "head-agent", "line", "active", "blank"]) {
		const row = rows.geekRow(rail, head, width, rail.startsWith("head") ? "14:52" : undefined);
		expect(`geekRow ${rail} @${width} is exactly ${width} cells`, visibleWidth(row) === width);
	}
	const split = rows.geekSplitRow(`› read session.ts token.ts · grep REFRESH_TTL`, "^o  // 3 call · 1 thought · 1.9s", width);
	expect(`geekSplitRow @${width} is exactly ${width} cells`, visibleWidth(split) === width);
}
expect("prefix is 8 cells", visibleWidth(rows.geekRowPrefix("line")) === rows.GEEK_PREFIX_WIDTH);
expect("time is right-aligned in the gutter", strip(rows.geekRowPrefix("head-user", "9:05")) === " 9:05 • ");
expect("geekNumber groups with '", rows.geekNumber(1204) === "1'204" && rows.geekNumber(41) === "41" && rows.geekNumber(1234567) === "1'234'567");

console.log(rows.geekRow("head-user", rows.geekHeadBody({ name: "bean", host: "kpi-api", cwd: "~/code/kpi-api", branch: "fix/refresh-ttl" }), 80, "14:52"));
console.log(rows.geekRow("line", "› refresh token expires after 5 minutes, fix it", 80));
console.log(rows.geekRow("active", rows.geekSplitRow("› pnpm test auth · read refresh.test.ts", "// 2 call · running · 4.1s", 72), 80));

rmSync(workDir, { recursive: true, force: true });
if (failures.length) {
	console.error(`geek-rows smoke FAILED:\n- ${failures.join("\n- ")}`);
	process.exit(1);
}
console.log("geek-rows smoke ok");
