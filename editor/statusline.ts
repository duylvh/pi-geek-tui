// One-row footer statusline (nvim style), on the chat grid. Pure: `renderStatusline(input, width)`.
//
//   [prefix: 8 cells]  [body: width - 8 cells]
//     HIGH   zai · glm-5.3 .......................... 41k/1.0M 4% · CH 82%  ○ 🐴 ponytail: ⚡ FULL
//
// The thinking badge sits IN the prefix (reverse-video accent block ending on the rail column), the model
// starts at body col 8 like every chat row, the metrics + extension statuses are right-aligned to the edge.
// Degrade ladder as the droid statusline: provider goes first, then CH%, then tokens, then ctx%; the rung
// that leaves room for the most status text wins (ties keep the richer rung); statuses end in `…`, nothing wraps.
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { GEEK_PREFIX_WIDTH } from "../presentation/geek-rows.js";
import { geekBg, geekFg } from "../theme/geek-palette.js";

export type StatuslineInput = {
	provider?: string;
	modelId?: string;
	/** Badge only when the model supports thinking and a level is known. */
	reasoning?: boolean;
	thinkingLevel?: string;
	/** The editor is in `!` bash mode: the BASH badge wins over the thinking badge. */
	bashMode?: boolean;
	/** Context usage; `tokens`/`percent` null = unknown (before the first usage / right after compaction). */
	contextWindow?: number;
	tokens?: number | null;
	percent?: number | null;
	cacheHitPercent?: number | null;
	/** Extension statuses, plain text, already joined with ` · `. */
	status?: string;
};

const MODEL_CAP = 40;
const MODEL_MIN = 8; // a rung that would cut the model below this is rejected (metrics outrank a clipped id)
const MIN_STATUS_CELLS = 6; // below this a truncated status is just noise: show none
const GAP = 2;
const BADGE_END = 6; // 0-based column of the rail glyph = the badge's last cell
const LEVEL_LABELS: Record<string, string> = { off: "OFF", minimal: "MIN", low: "LOW", medium: "MED", high: "HIGH", xhigh: "XHIGH" };

function compact(count: number): string {
	if (count < 1000) return String(Math.round(count));
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
}

function badgeLabel(input: StatuslineInput): { text: string; role: "accent" | "num" } | undefined {
	if (input.bashMode) return { text: "BASH", role: "num" };
	if (!input.reasoning || !input.thinkingLevel) return undefined;
	const level = input.thinkingLevel.toLowerCase();
	return { text: LEVEL_LABELS[level] ?? level.toUpperCase().slice(0, 5), role: "accent" };
}

/** 8 cells: the badge right-aligned to end on the rail column plus one gap cell, or blank. */
function prefix(input: StatuslineInput): string {
	const badge = badgeLabel(input);
	if (!badge) return " ".repeat(GEEK_PREFIX_WIDTH);
	const block = ` ${badge.text} `;
	const lead = Math.max(0, BADGE_END + 1 - block.length);
	return `${" ".repeat(lead)}${geekBg(badge.role, geekFg("bg", block))}${" ".repeat(GEEK_PREFIX_WIDTH - lead - block.length)}`;
}

/** Context metrics from richest to leanest (plain text), always ending with "" (nothing). */
function metricRungs(input: StatuslineInput): string[] {
	const percent = typeof input.percent === "number" && Number.isFinite(input.percent) ? `${Math.round(input.percent)}%` : "";
	const tokens = typeof input.tokens === "number" && Number.isFinite(input.tokens) && input.contextWindow
		? `${compact(input.tokens)}/${compact(input.contextWindow)}`
		: "";
	const cache = typeof input.cacheHitPercent === "number" && Number.isFinite(input.cacheHitPercent) ? `CH ${Math.round(input.cacheHitPercent)}%` : "";
	const context = [tokens, percent].filter(Boolean).join(" ") || "—";
	const rungs = [[context, cache].filter(Boolean).join(" · "), context, percent, ""];
	return rungs.filter((rung, i) => rung === "" ? i === rungs.length - 1 : rung !== rungs[i - 1]);
}

type Left = { plain: string; styled: string };

/** Model (and provider) fitted to `room` cells, or undefined when even the minimum model id does not fit. */
function leftCluster(input: StatuslineInput, withProvider: boolean, room: number): Left | undefined {
	const model = input.modelId ? truncateToWidth(input.modelId, MODEL_CAP, "…") : "";
	const provider = withProvider ? input.provider ?? "" : "";
	if (provider && model && visibleWidth(`${provider} · ${model}`) <= room) {
		return { plain: `${provider} · ${model}`, styled: `${geekFg("faint", `${provider} · `)}${geekFg("dim", model)}` };
	}
	if (!model) {
		if (!provider) return { plain: "", styled: "" };
		return visibleWidth(provider) <= room ? { plain: provider, styled: geekFg("faint", provider) } : undefined;
	}
	if (visibleWidth(model) <= room) return { plain: model, styled: geekFg("dim", model) };
	if (room < Math.min(MODEL_MIN, visibleWidth(model))) return undefined;
	const cut = truncateToWidth(model, room, "…");
	return { plain: cut, styled: geekFg("dim", cut) };
}

/** Status text that fits `budget` cells: whole, a legible `…`-cut prefix, or nothing. */
function fitStatus(status: string, budget: number): string {
	if (!status || budget < MIN_STATUS_CELLS) return "";
	return visibleWidth(status) <= budget ? status : truncateToWidth(status, budget, "…");
}

/** One row, exactly `width` cells. */
export function renderStatusline(input: StatuslineInput, width: number): string {
	const total = Math.max(0, Math.floor(width));
	if (total <= GEEK_PREFIX_WIDTH) return truncateToWidth(prefix(input), total, "", true);
	const bodyWidth = total - GEEK_PREFIX_WIDTH;
	const status = (input.status ?? "").replace(/[\r\n]+/g, " ").trim();
	const rungs = metricRungs(input);

	// Provider + richest metrics first, then provider dropped, then leaner metrics.
	const candidates = [{ withProvider: true, metrics: rungs[0]! }, ...rungs.map((metrics) => ({ withProvider: false, metrics }))];
	let best: { left: Left; metrics: string; shown: string } | undefined;
	let bestWidth = -1;
	for (const { withProvider, metrics } of candidates) {
		const metricsCells = visibleWidth(metrics) + (metrics ? GAP : 0);
		const leftPart = leftCluster(input, withProvider, bodyWidth - metricsCells);
		if (!leftPart) continue;
		const shown = fitStatus(status, bodyWidth - metricsCells - visibleWidth(leftPart.plain) - GAP);
		if (visibleWidth(shown) > bestWidth) {
			bestWidth = visibleWidth(shown);
			best = { left: leftPart, metrics, shown };
		}
	}
	// Even the bare model id does not fit (tiny widths): clip it to the body and show nothing else.
	const chosen = best ?? { left: leftCluster(input, false, Math.max(1, bodyWidth)) ?? { plain: "", styled: "" }, metrics: "", shown: "" };

	const rightPlain = [chosen.metrics, chosen.shown].filter(Boolean).join("  ");
	const rightStyled = [chosen.metrics, chosen.shown].filter(Boolean).map((part) => geekFg("dim", part)).join("  ");
	const gap = Math.max(rightPlain ? GAP : 0, bodyWidth - visibleWidth(chosen.left.plain) - visibleWidth(rightPlain));
	return truncateToWidth(`${prefix(input)}${chosen.left.styled}${" ".repeat(gap)}${rightStyled}`, total, "", true);
}
