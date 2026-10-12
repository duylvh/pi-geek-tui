// Core message blocks (compaction / skill / branch / custom) in the rail grammar:
//   ` • compaction · 12'345 tokens                 ^o expand`
//   ` ┊ summary markdown …`
import type { Component } from "@earendil-works/pi-tui";

import { GEEK_PREFIX_WIDTH, geekRow, geekSplitRow } from "../presentation/geek-rows.js";
import { geekFg } from "../theme/geek-palette.js";

export type RailMessageBlockOptions = {
	kind: string;
	title?: string;
	/** Right-aligned hint on the head row (already styled). */
	right?: string;
	body: (bodyWidth: number) => string[];
};

export function renderRailMessageBlock(options: RailMessageBlockOptions): Component {
	const label = geekFg("kw", options.kind) + (options.title ? geekFg("dim", ` · ${options.title}`) : "");
	return {
		invalidate() {},
		render(width: number): string[] {
			const bodyWidth = Math.max(1, width - GEEK_PREFIX_WIDTH - 1);
			const rows = [geekRow("head-agent", geekSplitRow(label, options.right ?? "", bodyWidth + 1), width)];
			for (const line of options.body(bodyWidth)) rows.push(geekRow("line", line, width));
			rows.push(geekRow("line", "", width));
			return rows;
		},
	};
}
