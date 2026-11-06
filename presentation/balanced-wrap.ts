// CSS `text-wrap: balance` for terminal text: a block that wraps onto 2-6 lines is re-wrapped at the narrowest
// width that keeps its line count, so the lines come out about equally long instead of a long line and a stub.
// Applied to notices (Pi's ThemedText: warnings, errors, status) and markdown headings, as CSS recommends.
import { Markdown, Text, stripTerminalSequences, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

const MAX_BALANCED_LINES = 6;
const PATCHED = Symbol.for("pi-geek-tui.balanced-wrap.patched");
const BALANCED = Symbol.for("pi-geek-tui.balanced-wrap.cache");

/** Narrowest wrap width (at most `width`) that wraps `line` onto as few lines as `width` does. */
export function balancedWrapWidth(line: string, width: number): number {
	const lineCount = wrapTextWithAnsi(line, width).length;
	if (lineCount < 2 || lineCount > MAX_BALANCED_LINES) return width;
	let low = Math.max(1, Math.floor(visibleWidth(stripTerminalSequences(line)) / lineCount));
	let high = width;
	while (low < high) {
		const mid = Math.floor((low + high) / 2);
		if (wrapTextWithAnsi(line, mid).length <= lineCount) high = mid;
		else low = mid + 1;
	}
	return high;
}

/** Each source line of `text` wrapped at its balanced width, joined back with newlines. */
export function balanceText(text: string, width: number): string {
	return text.split("\n").map((line) => {
		const balancedWidth = balancedWrapWidth(line, width);
		return balancedWidth === width ? line : wrapTextWithAnsi(line, balancedWidth).join("\n");
	}).join("\n");
}

type TextLike = { text: string; paddingX: number; build?: unknown; [BALANCED]?: { text: string; width: number; balanced: string } };

export function installBalancedWrap(TextClass: any = Text, MarkdownClass: any = Markdown): void {
	const textProto = TextClass?.prototype;
	if (textProto && !textProto[PATCHED] && typeof textProto.render === "function") {
		textProto[PATCHED] = true;
		const baseRender = textProto.render;
		textProto.render = function balancedTextRender(this: TextLike, width: number): string[] {
			// Only ThemedText (it carries `build`): plain Text also renders tool output, which must keep its breaks.
			if (typeof this.build !== "function" || !this.text) return baseRender.call(this, width);
			const paddingX = Math.min(this.paddingX, Math.max(0, Math.floor((width - 1) / 2)));
			const contentWidth = Math.max(1, width - paddingX * 2);
			let cache = this[BALANCED];
			if (cache?.text !== this.text || cache.width !== contentWidth) {
				cache = { text: this.text, width: contentWidth, balanced: balanceText(this.text, contentWidth) };
				this[BALANCED] = cache;
			}
			if (cache.balanced === this.text) return baseRender.call(this, width);
			const text = this.text;
			this.text = cache.balanced;
			try {
				return baseRender.call(this, width);
			} finally {
				this.text = text;
			}
		};
	}

	const markdownProto = MarkdownClass?.prototype;
	if (markdownProto && !markdownProto[PATCHED] && typeof markdownProto.renderToken === "function") {
		markdownProto[PATCHED] = true;
		const baseRenderToken = markdownProto.renderToken;
		// Pi wraps each line renderToken returns at the same width; lines pre-wrapped narrower pass through as they are.
		markdownProto.renderToken = function balancedRenderToken(this: unknown, token: any, width: number, ...rest: unknown[]): string[] {
			const lines: string[] = baseRenderToken.call(this, token, width, ...rest);
			if (token?.type !== "heading") return lines;
			return lines.flatMap((line) => balanceText(line, width).split("\n"));
		};
	}
}
