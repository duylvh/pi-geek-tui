#!/usr/bin/env node
/**
 * Footer (spec §9): exactly two rows under the rule; extension statuses live right-aligned on the `tok`
 * row (no third row), tok figures keep their width, statuses take the rest and are cut with `…`; no cost.
 */
import { rmSync } from "node:fs";
import { join } from "node:path";
import { visibleWidth } from "@earendil-works/pi-tui";
import { buildSmoke } from "./smoke-build.mjs";

const built = buildSmoke("geek-footer-smoke", ["editor/geek-editor.ts", "editor/live-state.ts"]);
const { GeekEditor } = await built.importBuilt("editor/geek-editor.js");
const strip = (text) => String(text).replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
const failures = [];
const expect = (name, condition, detail = "") => { if (!condition) failures.push(`${name}${detail ? `: ${detail}` : ""}`); };

const editorTheme = { borderColor: (s) => s, selectList: { selectedPrefix: (s) => s, selectedText: (s) => s, description: (s) => s, scrollInfo: (s) => s, noMatch: (s) => s } };
const editorFor = (status) => new GeekEditor({ requestRender() {}, terminal: { rows: 40, columns: 120 } }, editorTheme, { matches: () => false, getKeys: () => [] }, {
	cwd: join(built.workDir, "proj"),
	getContextUsage: () => ({ tokens: 62800, percent: 31.4, contextWindow: 200000 }),
	getModelInfo: () => ({ provider: "anthropic", id: "claude-opus-5-5", reasoning: true, thinkingLevel: "high" }),
	getBranch: () => null,
	getFooterStatus: () => status,
	getTokenUsage: () => ({ input: 41000, output: 6900, cacheRead: 212000, cacheWrite: 18000, cacheHitPercent: 82.4, cost: 0.412 }),
});
const STATUS = "🐴 ponytail: ⚡ FULL · quotas 5h 62% 7d 31%";
const footerOf = (editor, width) => {
	const rows = editor.render(width).map(strip);
	const rule = rows.findIndex((row) => /^─+$/.test(row));
	return { rows, footer: rows.slice(rule + 1), all: editor.render(width) };
};
const TOK = "↑41k ↓6.9k  R212k W18k  CH 82.4%";

for (const width of [120, 80, 50]) {
	const { footer, all } = footerOf(editorFor(STATUS), width);
	expect(`@${width}: exactly 2 footer rows (ctx, tok)`, footer.length === 2 && /^\s+ctx /.test(footer[0]) && /^\s+tok /.test(footer[1]), JSON.stringify(footer));
	expect(`@${width}: every row exactly ${width} cells`, all.every((row) => visibleWidth(row) === width || row === ""), all.map(visibleWidth).join(","));
	expect(`@${width}: tok figures keep full width`, footer[1].includes(TOK), JSON.stringify(footer[1]));
	expect(`@${width}: no cost anywhere`, !footer.some((row) => row.includes("$")), JSON.stringify(footer));
	const tok = footer[1];
	const gap = tok.indexOf(TOK) + TOK.length;
	expect(`@${width}: gap between figures and status is ≥ 2`, tok.slice(gap).startsWith("  "), JSON.stringify(tok.slice(gap)));
	if (width === 120) expect("@120: full status shown, ends at the right edge", tok.trimEnd().endsWith("62% 7d 31%") && visibleWidth(tok) === 120, JSON.stringify(tok));
	if (width === 80) expect("@80: status truncated from the right with …", tok.includes("…") && !tok.trimEnd().endsWith("31%") && tok.includes("🐴 ponytail"), JSON.stringify(tok));
	if (width === 50) expect("@50: almost no room → only …", tok.trimEnd().endsWith("…") && !tok.includes("ponytail"), JSON.stringify(tok));
}

const none = footerOf(editorFor(null), 120);
expect("no statuses: 2 rows, tok row has no right side", none.footer.length === 2 && none.footer[1].trimEnd().endsWith("CH 82.4%") && !none.footer.some((row) => row.includes("$")), JSON.stringify(none.footer));

console.log(footerOf(editorFor(STATUS), 120).footer.join("\n"));
console.log(footerOf(editorFor(STATUS), 80).footer.join("\n"));
rmSync(built.workDir, { recursive: true, force: true });
if (failures.length) {
	console.error(`geek footer smoke FAILED (${failures.length}):\n- ${failures.join("\n- ")}`);
	process.exit(1);
}
console.log("geek footer smoke ok");
