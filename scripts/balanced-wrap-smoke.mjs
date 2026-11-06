#!/usr/bin/env node
/**
 * Balanced wrapping (CSS `text-wrap: balance`): a notice that wraps onto a long line and a stub re-wraps onto lines
 * of about equal length, without gaining a line; one-line and over-six-line text keep Pi's greedy wrap.
 */
import { rmSync } from "node:fs";
import { Markdown, Text, stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { buildSmoke } from "./smoke-build.mjs";

const built = buildSmoke("balanced-wrap-smoke", ["presentation/balanced-wrap.ts"]);
const { installBalancedWrap } = await built.importBuilt("presentation/balanced-wrap.js");
installBalancedWrap(Text, Markdown);
installBalancedWrap(Text, Markdown);

const failures = [];
const expect = (name, condition, detail = "") => { if (!condition) failures.push(`${name}${detail ? `: ${detail}` : ""}`); };
const widths = (lines) => lines.map((line) => visibleWidth(stripTerminalSequences(line).trimEnd()));

const warning = "\x1b[33mWarning: Anthropic subscription auth is active. Third-party harness usage draws from extra usage and is billed per token. Disable this warning in /settings.\x1b[39m";
const notice = new Text(warning, 1, 0);
notice.build = () => warning;
const greedy = new Text(warning, 1, 0);
const balanced = widths(notice.render(102));
const plain = widths(greedy.render(102));
expect("a notice keeps its line count", balanced.length === plain.length && balanced.length === 2, JSON.stringify({ balanced, plain }));
expect("a notice's lines come out about equal", Math.max(...balanced) - Math.min(...balanced) <= 12, JSON.stringify(balanced));
expect("plain Text (tool output) keeps the greedy wrap", plain[0] > plain[1] + 40, JSON.stringify(plain));
expect("a balanced notice keeps its color on every line", notice.render(102).every((line) => line.includes("\x1b[33m")));

const oneLine = new Text("Short status.", 1, 0);
oneLine.build = () => "Short status.";
expect("one-line text is untouched", widths(oneLine.render(80))[0] === "Short status.".length + 1);

const longText = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ");
const longNotice = new Text(longText, 0, 0);
longNotice.build = () => longText;
expect("text over six lines keeps the greedy wrap",
	JSON.stringify(widths(longNotice.render(40))) === JSON.stringify(widths(new Text(longText, 0, 0).render(40))));

const theme = { heading: (s) => s, bold: (s) => s, underline: (s) => s, italic: (s) => s, code: (s) => s, codeBlock: (s) => s, codeBlockBorder: (s) => s, quote: (s) => s, quoteBorder: (s) => s, hr: (s) => s, listBullet: (s) => s, link: (s) => s, linkUrl: (s) => s, strikethrough: (s) => s };
const heading = new Markdown("### Balanced headings keep both of their lines about the same length on narrow panes", 0, 0, theme);
const headingWidths = widths(heading.render(60)).filter(Boolean);
expect("a two-line heading is balanced", headingWidths.length === 2 && Math.abs(headingWidths[0] - headingWidths[1]) <= 10, JSON.stringify(headingWidths));

rmSync(built.workDir, { recursive: true, force: true });
if (failures.length) {
	console.error(`balanced wrap smoke FAILED (${failures.length}):\n- ${failures.join("\n- ")}`);
	process.exit(1);
}
console.log("balanced wrap smoke ok");
