// Markdown look (spec §5), applied to every pi-tui Markdown instance:
//   `## heading` accent · inline code = faint backticks + mono text · list `-` accent · numbers num
//   · code blocks = 2-col indent, `// lang` label. Done by patching Markdown.prototype once.
import { Markdown, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { geekFg } from "../theme/geek-palette.js";

const PATCHED = Symbol.for("pi-geek-tui.markdown-geek.patched");
const THEMED = Symbol.for("pi-geek-tui.markdown-geek.themed");
const CODE_INDENT = "  ";

interface MarkdownLike {
	theme?: Record<string, any>;
	defaultTextStyle?: { color?: (text: string) => string };
	[THEMED]?: boolean;
}

const NUMBER = /((?<![A-Za-z0-9_])\d+(?:[.,':]\d+)*%?(?![A-Za-z0-9_]))/;

/** Ink text with numbers picked out in the `num` color. */
export function geekTextColor(text: string): string {
	if (!text) return geekFg("ink", text); // Markdown probes the color fn with a sentinel for its style prefix
	return text.split(NUMBER).map((part, i) => (part ? geekFg(i % 2 ? "num" : "ink", part) : "")).join("");
}

function geekTheme(base: Record<string, any>): Record<string, any> {
	return {
		...base,
		heading: (text: string) => geekFg("accent", text),
		code: (text: string) => `${geekFg("faint", "`")}${geekFg("mono", text)}${geekFg("faint", "`")}`,
		codeBlock: (text: string) => geekFg("mono", text),
		codeBlockBorder: (text: string) => geekFg("faint", text),
		listBullet: (text: string) => geekFg(/^\d/.test(text) ? "num" : "accent", text),
		quote: (text: string) => geekFg("dim", text),
		quoteBorder: (text: string) => geekFg("faint", text),
		hr: (text: string) => geekFg("faint", text),
		linkUrl: (text: string) => geekFg("faint", text),
	};
}

function ensureGeekLook(component: MarkdownLike): void {
	if (component[THEMED]) return;
	component[THEMED] = true;
	if (component.theme) component.theme = geekTheme(component.theme);
	component.defaultTextStyle ??= { color: geekTextColor };
}

function renderCodeLine(line: string, width: number): string[] {
	const contentWidth = Math.max(1, width - visibleWidth(CODE_INDENT));
	return wrapTextWithAnsi(line, contentWidth).map((wrapped) => `${CODE_INDENT}${wrapped}`);
}

function renderCodeBlock(component: MarkdownLike, token: { text?: string; lang?: string }, width: number, nextTokenType: string | undefined): string[] {
	const lines: string[] = [];
	const language = (token.lang ?? "").trim().split(/\s+/, 1)[0];
	const code = typeof token.text === "string" ? token.text : "";
	if (language) lines.push(...renderCodeLine(geekFg("faint", `// ${language}`), width));

	let codeLines = code.split("\n").map((line) => geekFg("mono", line));
	const highlightCode = component.theme?.highlightCode;
	if (typeof highlightCode === "function") {
		try {
			const highlighted = highlightCode(code, language || undefined);
			if (Array.isArray(highlighted)) codeLines = highlighted;
		} catch {
			// Fall back to the mono color above.
		}
	}
	for (const line of codeLines) lines.push(...renderCodeLine(line, width));

	if (nextTokenType && nextTokenType !== "space") lines.push("");
	return lines;
}

export function installMarkdownCodeBlockRenderer(MarkdownClass: any = Markdown): void {
	const proto = MarkdownClass?.prototype;
	if (!proto || proto[PATCHED]) return;

	const baseRenderToken = proto.renderToken;
	const baseRender = proto.render;
	if (typeof baseRenderToken !== "function" || typeof baseRender !== "function") return;
	proto[PATCHED] = true;

	proto.render = function patchedMarkdownRender(this: MarkdownLike, width: number): string[] {
		ensureGeekLook(this);
		return baseRender.call(this, width);
	};

	proto.renderToken = function patchedMarkdownRenderToken(this: MarkdownLike, token: any, width: number, nextTokenType?: string, styleContext?: any): string[] {
		if (token?.type === "code") return renderCodeBlock(this, token, width, nextTokenType);
		const lines: string[] = baseRenderToken.call(this, token, width, nextTokenType, styleContext);
		// Pi omits the `#` marks for h1/h2; the geek heading keeps them (`## cause`).
		if (token?.type === "heading" && token.depth < 3 && lines.length > 0) {
			lines[0] = `${geekFg("accent", `${"#".repeat(token.depth)} `)}${lines[0]}`;
		}
		return lines;
	};
}
