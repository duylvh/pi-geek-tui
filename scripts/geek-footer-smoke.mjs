#!/usr/bin/env node
/**
 * Footer (spec §9): under the rule exactly ONE statusline row on the chat grid (thinking badge at the line start,
 * provider · model, ctx metrics + extension statuses right-aligned); no ctx/tok labels, no bar, no cost.
 * The statusline's own ladder/badge details are covered by statusline-smoke; this checks the editor wiring.
 */
import { rmSync } from "node:fs";
import { join } from "node:path";
import { visibleWidth } from "@earendil-works/pi-tui";
import { buildSmoke } from "./smoke-build.mjs";

const built = buildSmoke("geek-footer-smoke", ["editor/geek-editor.ts", "editor/live-state.ts"]);
const { GeekEditor } = await built.importBuilt("editor/geek-editor.js");
const { GEEK_PREFIX_WIDTH } = await built.importBuilt("presentation/geek-rows.js");
const strip = (text) => String(text).replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
const failures = [];
const expect = (name, condition, detail = "") => { if (!condition) failures.push(`${name}${detail ? `: ${detail}` : ""}`); };

const editorTheme = { borderColor: (s) => s, selectList: { selectedPrefix: (s) => s, selectedText: (s) => s, description: (s) => s, scrollInfo: (s) => s, noMatch: (s) => s } };
const editorFor = ({ status = null, usage = true, context = true, reasoning = true, text = "" } = {}) => {
	const editor = new GeekEditor({ requestRender() {}, terminal: { rows: 40, columns: 120 } }, editorTheme, { matches: () => false, getKeys: () => [] }, {
		cwd: join(built.workDir, "proj"),
		getContextUsage: () => context ? { tokens: 62800, percent: 31.4, contextWindow: 200000 } : { tokens: null, percent: null, contextWindow: 200000 },
		getModelInfo: () => ({ provider: "anthropic", id: "claude-opus-5-5", reasoning, thinkingLevel: "high" }),
		getBranch: () => null,
		getFooterStatus: () => status,
		getTokenUsage: () => !usage ? null : ({ input: 41000, output: 6900, cacheRead: 212000, cacheWrite: 18000, cacheHitPercent: 82.4 }),
	});
	editor.setText(text);
	return editor;
};
const STATUS = "🐴 ponytail: ⚡ FULL · quotas 5h 62% 7d 31%";
const footerOf = (editor, width) => {
	const all = editor.render(width);
	const rows = all.map(strip);
	const rule = rows.findIndex((row) => /^─+$/.test(row));
	return { all, footer: rows.slice(rule + 1), rows };
};

for (const width of [120, 80, 50]) {
	const { all, footer, rows } = footerOf(editorFor({ status: STATUS }), width);
	expect(`@${width}: exactly one footer row`, footer.length === 1, JSON.stringify(footer));
	{
		const rule = rows.findIndex((row) => /^─+$/.test(row));
		expect(`@${width}: the rule sits directly under the input (no blank row)`, rule > 0 && rows[rule - 1].trim() !== "", JSON.stringify(rows.slice(-3)));
		const multi = editorFor({ status: STATUS, text: "line one\nline two" });
		const m = footerOf(multi, width).rows, mr = m.findIndex((row) => /^─+$/.test(row));
		expect(`@${width}: multi-line input ends right above the rule`, mr > 0 && m[mr - 1].includes("line two"), JSON.stringify(m.slice(-4)));
	}
	expect(`@${width}: every row exactly ${width} cells`, all.every((row) => visibleWidth(row) === width || row === ""), all.map(visibleWidth).join(","));
	expect(`@${width}: no ctx/tok labels, bar, token arrows or cost`, !/\b(ctx|tok)\b|[█░↑↓$]/.test(footer.join("\n")), JSON.stringify(footer));
	expect(`@${width}: HIGH badge at the line start, then the model`, footer[0].startsWith(" HIGH  ") && /^\S/.test(footer[0].slice(7)), JSON.stringify(footer[0]));
	if (width === 120) {
		expect("@120: provider · model, metrics and the whole status, ending at the right edge", footer[0].includes("anthropic · claude-opus-5-5") && footer[0].includes("63k/200k 31% · CH 82%") && footer[0].trimEnd().endsWith("62% 7d 31%") && visibleWidth(footer[0]) === 120, JSON.stringify(footer[0]));
	} else {
		expect(`@${width}: model stays, status is cut with … (or fits)`, footer[0].includes("claude-opus-5-5") && (footer[0].includes("…") || footer[0].trimEnd().endsWith("31%")), JSON.stringify(footer[0]));
	}
}

expect("bash mode (`!` prefix) swaps the badge", footerOf(editorFor({ text: "!ls" }), 120).footer[0].startsWith(" BASH  "));
expect("model without thinking: model on the body column", footerOf(editorFor({ reasoning: false }), 120).footer[0].startsWith(" ".repeat(GEEK_PREFIX_WIDTH) + "anthropic"));
expect("no statuses: nothing after the metrics", /CH 82%\s*$/.test(footerOf(editorFor(), 120).footer[0]));
expect("no usage yet: metrics read — and CH is absent", /—\s*$/.test(footerOf(editorFor({ context: false, usage: false }), 120).footer[0]) && !footerOf(editorFor({ context: false, usage: false }), 120).footer[0].includes("CH"));

console.log(footerOf(editorFor({ status: STATUS }), 120).all.slice(-2).join("\n"));
console.log(footerOf(editorFor({ status: STATUS }), 70).all.slice(-1).join("\n"));
rmSync(built.workDir, { recursive: true, force: true });
if (failures.length) {
	console.error(`geek footer smoke FAILED (${failures.length}):\n- ${failures.join("\n- ")}`);
	process.exit(1);
}
console.log("geek footer smoke ok");
