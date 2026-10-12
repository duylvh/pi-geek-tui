import { FooterComponent } from "@earendil-works/pi-coding-agent";

const PATCHED = Symbol.for("pi-geek-tui.footer-stats.patched");
const ORIGINAL_RENDER = Symbol.for("pi-geek-tui.footer-stats.original-render");
const FOOTER_STATE = Symbol.for("pi-geek-tui.footer-stats.state");
const PATCH_VERSION = 7;

const ANSI_PATTERN = /\x1b\][^\x07]*(?:\x07|\x1b\\)|\x1b\[[0-9;?]*[ -/]*[@-~]/g;

/** Last assistant message usage, for the footer `tok` row. */
export type FooterTokenUsage = {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	/** Cache read share of prompt tokens, 0-100. */
	cacheHitPercent: number;
};

type FooterState = {
	latestStatusLines: string[];
	latestTokenUsage: FooterTokenUsage | null;
};

function footerState(): FooterState {
	const globalState = globalThis as Record<symbol, FooterState | undefined>;
	let state = globalState[FOOTER_STATE];
	if (!state) {
		state = { latestStatusLines: [], latestTokenUsage: null };
		globalState[FOOTER_STATE] = state;
	}
	return state;
}

function sanitizeStatusText(text: string): string {
	return text.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim();
}

// undefined = the status source could not be read; [] = it was read and is empty (a cleared status).
function readExtensionStatusLines(owner: any): string[] | undefined {
	try {
		const statuses = owner?.footerData?.getExtensionStatuses?.();
		if (!(statuses instanceof Map)) return undefined;
		return Array.from(statuses.entries())
			.sort(([a], [b]) => String(a).localeCompare(String(b)))
			.map(([, text]) => sanitizeStatusText(String(text ?? "")))
			.filter(Boolean);
	} catch {
		return undefined;
	}
}

function stripAnsi(text: string): string {
	return text.replace(ANSI_PATTERN, "");
}

function computeTokenUsage(session: any): FooterTokenUsage | null {
	if (!session?.sessionManager?.getEntries) return null;
	const entries = session.sessionManager.getEntries();
	let latest: any = null;
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (entry?.type !== "message" || entry?.message?.role !== "assistant") continue;
		const u = entry.message.usage;
		if (!u || entry.message.stopReason === "aborted" || entry.message.stopReason === "error") continue;
		latest = u;
		break;
	}
	if (!latest) return null;
	const input = latest.input ?? 0;
	const cacheRead = latest.cacheRead ?? 0;
	const cacheWrite = latest.cacheWrite ?? 0;
	const promptTokens = input + cacheRead + cacheWrite;
	return {
		input,
		output: latest.output ?? 0,
		cacheRead,
		cacheWrite,
		cacheHitPercent: promptTokens > 0 ? (cacheRead / promptTokens) * 100 : 0,
	};
}

export function getFooterTokenUsage(): FooterTokenUsage | null {
	return footerState().latestTokenUsage;
}

export function getFooterStatusLine(): string | null {
	const statusLines = footerState().latestStatusLines;
	return statusLines.length > 0 ? statusLines.join(" · ") : null;
}

export function installFooterStatsPatch() {
	const proto = FooterComponent.prototype as any;
	if (proto[PATCHED] === PATCH_VERSION) return;

	const origRender = proto[ORIGINAL_RENDER] ?? proto.render;
	proto[ORIGINAL_RENDER] = origRender;
	proto[PATCHED] = PATCH_VERSION;
	proto.render = function (width: number): string[] {
		const lines: string[] = origRender.call(this, width);

		// Capture extension statuses and compute token usage directly from session
		// entries (not parsed from the rendered stats line, which can be truncated).
		const directStatusLines = readExtensionStatusLines(this);
		if (directStatusLines) {
			footerState().latestStatusLines = directStatusLines;
		} else {
			// Unreadable source: guess from the rendered lines, and never wipe the last known status.
			const statusLines = lines.slice(2).map((line) => sanitizeStatusText(line ?? "")).filter(Boolean);
			if (statusLines.length > 0) footerState().latestStatusLines = statusLines;
		}
		footerState().latestTokenUsage = computeTokenUsage(this.session);
		return [];
	};
}
