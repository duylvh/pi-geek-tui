#!/usr/bin/env node
/**
 * Fullscreen selection over the transcript skips the rail prefix: Pi's real TuiAltScreen column math, wrapped by
 * installSelectionSkipsRail, yields only message text for drags that start inside the transcript (transcript rows) and
 * drags that start in the left margin (whole screen rows, rail behind the configured margin).
 */
import { rmSync } from "node:fs";
import { sliceByColumn, stripTerminalSequences, TuiAltScreen } from "@earendil-works/pi-tui";
import { buildSmoke } from "./smoke-build.mjs";

const built = buildSmoke("selection-rail-smoke", ["selection-rail.ts", "tui-padding.ts"]);
const { installSelectionSkipsRail } = await built.importBuilt("selection-rail.js");
const { installTuiPadding } = await built.importBuilt("tui-padding.js");
installTuiPadding({ render: () => [] }, 2);

const failures = [];
const expect = (name, condition, detail = "") => { if (!condition) failures.push(`${name}${detail ? `: ${detail}` : ""}`); };

const renderer = Object.create(TuiAltScreen.prototype);
installSelectionSkipsRail(renderer);
installSelectionSkipsRail(renderer);

const rail = (glyph) => ` \x1b[38;2;58;58;52m${glyph}\x1b[39m `;
const transcript = [
	`${rail("•")}\x1b[1mbean\x1b[22m@proj ~/proj`,
	`${rail("┊")}First line of the answer.`,
	`${rail("┊")}  indented code`,
	`${rail("┃")}read config.ts`,
	`   `,
	`[Skill conflicts]`,
];
const scrollView = {};
const copy = (lines, selection, minColumn) => lines.map((line, row) => {
	const { start, end } = renderer.getSelectionColumns(line, row, selection, minColumn);
	return stripTerminalSequences(sliceByColumn(line, start, Math.max(0, end - start), true)).trimEnd();
});

const dragAll = { start: { row: 0, col: 0, scrollView }, end: { row: transcript.length - 1, col: 200, scrollView } };
expect("copy keeps only message text, indentation inside the message kept, non-rail rows untouched",
	JSON.stringify(copy(transcript, dragAll)) === JSON.stringify(["bean@proj ~/proj", "First line of the answer.", "  indented code", "read config.ts", "", "[Skill conflicts]"]),
	JSON.stringify(copy(transcript, dragAll)));

const margin = "  ";
const screen = transcript.map((line) => margin + line);
const screenColumns = screen.map((line, row) => renderer.getSelectionColumns(line, row, dragAll, margin.length));
expect("highlight starts after the rail behind the margin", screenColumns.slice(0, 4).every((columns) => columns.start === margin.length + 3), JSON.stringify(screenColumns));

const insideRail = { start: { row: 1, col: 1, scrollView }, end: { row: 1, col: 1, scrollView } };
const railOnly = renderer.getSelectionColumns(transcript[1], 1, insideRail);
expect("a selection inside the rail selects nothing", railOnly.end <= railOnly.start, JSON.stringify(railOnly));

const fromMargin = { start: { row: 0, col: 0 }, end: { row: screen.length - 1, col: 200 } };
expect("a drag from the left margin copies only message text from screen rows",
	JSON.stringify(copy(screen, fromMargin)) === JSON.stringify(["bean@proj ~/proj", "First line of the answer.", "  indented code", "read config.ts", "", "  [Skill conflicts]"]),
	JSON.stringify(copy(screen, fromMargin)));

rmSync(built.workDir, { recursive: true, force: true });
if (failures.length) {
	console.error(`selection rail smoke FAILED (${failures.length}):\n- ${failures.join("\n- ")}`);
	process.exit(1);
}
console.log("selection rail smoke ok");
