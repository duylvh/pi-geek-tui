// Markdown look (spec §5), applied to every pi-tui Markdown instance:
//   `## ` marks kept on h1/h2 · inline code = faint backticks + mono text · ordered markers + numbers num
//   · code blocks = 2-col indent, `// lang` label, dim base. Done by patching Markdown.prototype once.
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
function geekTextColor(text: string): string {
	if (!text) return geekFg("ink", text); // Markdown probes the color fn with a sentinel for its style prefix
	return text.split(NUMBER).map((part, i) => (part ? geekFg(i % 2 ? "num" : "ink", part) : "")).join("");
}

// Pi renders each mermaid diagram row as an inline code span; box-drawing rows keep their own colors and no backticks.
const BOX_DRAWING = /[\u2500-\u257f]/;

// Pi's host theme (theme/geek-theme.ts) already colors headings, bullets, quotes, links and syntax;
// only what it cannot express is overridden here.
function geekTheme(base: Record<string, any>): Record<string, any> {
	return {
		...base,
		code: (text: string) => (BOX_DRAWING.test(text) ? text : `${geekFg("faint", "`")}${geekFg("mono", text)}${geekFg("faint", "`")}`),
		listBullet: (text: string) => (/^\d/.test(text) ? geekFg("num", text) : base.listBullet(text)),
	};
}

function ensureGeekLook(component: MarkdownLike): void {
	if (component[THEMED]) return;
	component[THEMED] = true;
	if (component.theme) component.theme = geekTheme(component.theme);
	component.defaultTextStyle ??= { color: geekTextColor };
}

// Code sits one step below prose: plain code is `dim`, syntax tokens keep their palette colors. hljs leaves
// identifiers/operators uncolored (terminal default fg), so the base is restored after every fg reset.
// The host theme maps identifiers/variables to `ink` (prose color); in code those read `dim` too.
const CODE_BASE_START = geekFg("dim", "\0").split("\0")[0]!;
const INK_START = geekFg("ink", "\0").split("\0")[0]!;
const FG_RESET = "\x1b[39m";
function codeBase(line: string): string {
	const dimmed = line.replaceAll(INK_START, CODE_BASE_START);
	return `${CODE_BASE_START}${dimmed.replaceAll(FG_RESET, FG_RESET + CODE_BASE_START)}${FG_RESET}`;
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

	let codeLines = code.split("\n").map((line) => geekFg("dim", line));
	const highlightCode = component.theme?.highlightCode;
	if (typeof highlightCode === "function") {
		try {
			const highlighted = highlightCode(code, language || undefined);
			if (Array.isArray(highlighted)) codeLines = highlighted.map(codeBase);
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
		if (token?.type === "heading" && lines.length > 0) {
			// Pi omits the `#` marks for h1/h2; the geek heading keeps them (`## cause`)...
			if (token.depth < 3) lines[0] = `${geekFg("accent", `${"#".repeat(token.depth)} `)}${lines[0]}`;
			// ...and sits directly on its text (no blank row after it).
			if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
		}
		return lines;
	};
}
