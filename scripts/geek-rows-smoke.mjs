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
	const head = rows.geekHeadBody({ name: "bean", host: "kpi-api", cwd: "~/code/kpi-api", branch: "fix/refresh-ttl" }, "user");
	for (const rail of ["head-user", "head-agent", "line", "active", "blank"]) {
		const row = rows.geekRow(rail, head, width);
		expect(`geekRow ${rail} @${width} is exactly ${width} cells`, visibleWidth(row) === width);
	}
	const split = rows.geekSplitRow(`› read session.ts token.ts · grep REFRESH_TTL`, "^o  // 3 call · 1 thought · 1.9s", width);
	expect(`geekSplitRow @${width} is exactly ${width} cells`, visibleWidth(split) === width);
}
expect("prefix is the glyph centered in 3 cells", visibleWidth(rows.geekRowPrefix("line")) === rows.GEEK_PREFIX_WIDTH && strip(rows.geekRowPrefix("head-user")) === " • ");
// Head rows: the name stands out (bold, role color), everything after it recedes (faint, not bold).
const info = { name: "bean", host: "kpi-api", cwd: "~/code/kpi-api", branch: "fix/refresh-ttl" };
for (const [role, nameFg] of [["user", "216;212;180"], ["agent", "104;158;128"]]) {
	const raw = rows.geekHeadBody({ ...info, name: role === "agent" ? "pi" : "bean" }, role);
	const name = role === "agent" ? "pi" : "bean";
	const FAINT = "\x1b[38;2;82;91;84m";
	expect(`${role} head: name bold in its role color`, raw.startsWith(`\x1b[1m\x1b[38;2;${nameFg}m${name}\x1b[39m\x1b[22m`), JSON.stringify(raw));
	const rest = raw.slice(raw.indexOf("\x1b[22m") + 5);
	expect(`${role} head: @host, path and (branch) are faint, none bold`, rest === `${FAINT}@kpi-api\x1b[39m ${FAINT}~/code/kpi-api\x1b[39m ${FAINT}(fix/refresh-ttl)\x1b[39m`, JSON.stringify(rest));
}
expect("geekNumber groups with '", rows.geekNumber(1204) === "1'204" && rows.geekNumber(41) === "41" && rows.geekNumber(1234567) === "1'234'567");

console.log(rows.geekRow("head-user", rows.geekHeadBody({ name: "bean", host: "kpi-api", cwd: "~/code/kpi-api", branch: "fix/refresh-ttl" }, "user"), 80));
console.log(rows.geekRow("line", "› refresh token expires after 5 minutes, fix it", 80));
console.log(rows.geekRow("active", rows.geekSplitRow("› pnpm test auth · read refresh.test.ts", "// 2 call · running · 4.1s", 72), 80));

rmSync(workDir, { recursive: true, force: true });
if (failures.length) {
	console.error(`geek-rows smoke FAILED:\n- ${failures.join("\n- ")}`);
	process.exit(1);
}
console.log("geek-rows smoke ok");
