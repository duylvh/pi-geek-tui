#!/usr/bin/env node
/**
 * Dev check (not in `npm run check`: it reads ~/.pi): runs every toolCall from the most recent session files
 * through the real per-call row formatter. Expects zero throws, zero blank rows, exactly one row per call.
 * Usage: node scripts/tool-row-corpus.mjs [sessionCount=60]
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const repo = process.cwd();
const out = join(repo, ".pi", "tool-row-corpus-build");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "package.json"), '{"type":"module"}\n');
const compile = spawnSync(process.execPath, [
	join(repo, "node_modules", "typescript", "lib", "tsc.js"), "--outDir", out, "--rootDir", repo, "--module", "NodeNext",
	"--moduleResolution", "NodeNext", "--target", "ES2022", "--skipLibCheck", "--noImplicitAny", "false", "tool-tags/tool-groups.ts", "tool-tags/edit.ts", "tool-tags/write.ts",
], { cwd: repo, encoding: "utf8" });
if (compile.status !== 0) throw new Error(`tsc failed\n${compile.stdout}${compile.stderr}`);
const groups = await import(pathToFileURL(join(out, "tool-tags", "tool-groups.js")).href);
const edit = await import(pathToFileURL(join(out, "tool-tags", "edit.js")).href);
const write = await import(pathToFileURL(join(out, "tool-tags", "write.js")).href);
const STANDALONE = new Set(["edit", "write"]);
const strip = (text) => String(text).replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");

const root = join(homedir(), ".pi", "agent", "sessions");
const files = readdirSync(root)
	.flatMap((dir) => (existsSync(join(root, dir)) && statSync(join(root, dir)).isDirectory() ? readdirSync(join(root, dir)).filter((f) => f.endsWith(".jsonl")).map((f) => join(root, dir, f)) : []))
	.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
	.slice(0, Number(process.argv[2] ?? 60));

const counts = new Map();
const failures = [];
let total = 0;
for (const file of files) {
	for (const line of readFileSync(file, "utf8").split("\n")) {
		if (!line.includes('"toolCall"')) continue;
		let entry;
		try { entry = JSON.parse(line); } catch { continue; }
		for (const block of entry.message?.content ?? []) {
			if (block?.type !== "toolCall") continue;
			total++;
			counts.set(block.name, (counts.get(block.name) ?? 0) + 1);
			for (const args of [block.arguments, {}, undefined]) {
				const tool = { toolCallId: "c", toolName: block.name, args, expanded: false, isPartial: false, rendererState: {}, result: { content: [], details: {} }, render: () => ["RAW"] };
				try {
					if (STANDALONE.has(block.name)) {
						// edit/write draw their own stand-alone row; every other tool goes through the grouped chat rows.
						const render = block.name === "write" ? write.renderWriteCall : edit.renderEditCall;
						const call = render(args, {}, { state: {}, cwd: "/repo", isPartial: false }).render(112).map(strip).filter((row) => row.trim());
						if (call.length !== 1) failures.push(`${block.name}: ${call.length} rows`);
						continue;
					}
					const call = groups.renderChatChildren([tool], 120).map(strip).filter((row) => row.slice(8).trim().length > 0);
					if (call.length !== 1) failures.push(`${block.name}: ${call.length} rows`);
				} catch (error) {
					failures.push(`${block.name}: threw ${error}`);
				}
			}
		}
	}
}

console.log(`sessions=${files.length} toolCalls=${total} failures=${failures.length}`);
for (const [name, count] of [...counts].sort((a, b) => b[1] - a[1])) console.log(`${String(count).padStart(6)}  ${name}`);
if (failures.length) {
	console.error(failures.slice(0, 20).join("\n"));
	process.exit(1);
}
rmSync(out, { recursive: true, force: true });
