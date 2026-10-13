import { safeTruncateToWidth, safeVisibleWidth } from "./render-budget.js";
import { getOriginalTuiMethod, rememberTuiMethodWrapper } from "./performance/tui-proxy-original.js";

/**
 * Add one-column horizontal padding to the entire TUI output.
 * Regular mode (`--tui-mode regular`) wraps TUI.render; fullscreen mode wraps the layout root.
 */


interface AnyComponent {
	render(width: number): string[];
}

// Margin: 2 cells each side.
const PAD_LEFT = 2;
const PAD_RIGHT = 2;
const PADDING_PREFIX = " ".repeat(PAD_LEFT);
const KITTY_IMAGE_PREFIX = "\x1b_G";
const ITERM_IMAGE_PREFIX = "\x1b]1337;File=";

const PATCHED = Symbol.for("pi-geek-tui.tui-padding.patched");
const ORIGINAL_RENDER = Symbol.for("pi-geek-tui.tui-padding.original-render");
const FULLSCREEN_LAYOUT_PATCHED = Symbol.for("pi-geek-tui.tui-padding.fullscreen-layout-patched");
const LAYOUT_NODE = Symbol.for("@earendil-works/pi-tui/layout-node");

function isTerminalImageLine(line: string): boolean {
	return line.includes(KITTY_IMAGE_PREFIX) || line.includes(ITERM_IMAGE_PREFIX);
}

function getTuiContentInnerWidth(width: number): number {
	return Math.max(1, width - PAD_LEFT - PAD_RIGHT);
}

function padTuiContentLine(line: string, width: number): string {
	const padded = `${PADDING_PREFIX}${line}`;
	if (isTerminalImageLine(line)) return padded;
	const targetWidth = Math.max(0, Math.floor(width));
	if (targetWidth === 0) return padded;
	const visible = safeVisibleWidth(padded);
	if (visible > targetWidth) {
		return safeTruncateToWidth(padded, targetWidth, "");
	}
	if (visible < targetWidth) {
		return `${padded}${" ".repeat(targetWidth - visible)}`;
	}
	return padded;
}

type LayoutComponent = AnyComponent & {
	invalidate?(): void;
	[LAYOUT_NODE]?: () => unknown;
	[FULLSCREEN_LAYOUT_PATCHED]?: true;
};

const HORIZONTAL_GUTTER: LayoutComponent = {
	render: () => [],
};

type StackEntry = { component: LayoutComponent; [key: string]: unknown };
type ScrollViewLike = LayoutComponent & { getContentWidth(width: number): number; scrollbar: unknown };

function isScrollView(component: unknown): component is ScrollViewLike {
	const candidate = component as Partial<ScrollViewLike> | undefined;
	return typeof candidate?.getContentWidth === "function" && candidate.scrollbar !== undefined;
}

function gutterEntry(width: number): StackEntry {
	return { component: HORIZONTAL_GUTTER, basis: width, minSize: width, maxSize: width };
}

// One margin-wrapped row per root stack entry. A transcript ScrollView draws its transient scrollbar on
// the LAST column of its rect (Pi only reserves a column for scrollbar:"always"), i.e. over right-aligned
// text. So its row gets a right gutter one cell narrower and the ScrollView reserves exactly that cell:
// content width stays identical to every other row and the bar lives in the right margin.
const rowWrappers = new WeakMap<object, LayoutComponent>();

function marginRow(component: LayoutComponent): LayoutComponent {
	let wrapper = rowWrappers.get(component);
	if (wrapper) return wrapper;
	const scroll = isScrollView(component);
	if (scroll) component.getContentWidth = (width) => (width > 1 ? width - 1 : width);
	const rightGutter = scroll ? Math.max(0, PAD_RIGHT - 1) : PAD_RIGHT;
	wrapper = {
		render: (width) => component.render(Math.max(1, width - PAD_LEFT - rightGutter)).map((line) => `${PADDING_PREFIX}${line}`),
		invalidate: () => component.invalidate?.(),
		[LAYOUT_NODE]: () => ({
			type: "hstack",
			entries: [gutterEntry(PAD_LEFT), { component, basis: 0, grow: 1, shrink: 1, minSize: 1 }, gutterEntry(rightGutter)],
			gap: 0,
			align: "stretch",
		}),
	};
	rowWrappers.set(component, wrapper);
	return wrapper;
}

function installFullscreenTuiPadding(tui: any): boolean {
	if (tui?.mode !== "fullscreen" || typeof tui.setLayoutRoot !== "function") return false;
	const root = tui.layoutRoot as LayoutComponent | undefined;
	const originalLayoutNode = root?.[LAYOUT_NODE];
	if (!root || typeof originalLayoutNode !== "function") return false;
	if (root[FULLSCREEN_LAYOUT_PATCHED]) return true;

	// Fullscreen renders the layout tree directly and never calls TUI.render().
	// Inset the persistent root so layout also shifts cursor and selection geometry.
	const content: LayoutComponent = {
		render: (width) => root.render(width),
		invalidate: () => root.invalidate?.(),
		[LAYOUT_NODE]: () => originalLayoutNode.call(root),
	};
	root[LAYOUT_NODE] = () => {
		const node = originalLayoutNode.call(root) as { type?: string; entries?: StackEntry[] };
		if (node?.type === "vstack" && Array.isArray(node.entries)) {
			return { ...node, entries: node.entries.map((entry) => ({ ...entry, component: marginRow(entry.component) })) };
		}
		// Unknown root shape: inset the whole root (scrollbar lane then stays inside the content).
		return {
			type: "hstack",
			entries: [gutterEntry(PAD_LEFT), { component: content, basis: 0, grow: 1, shrink: 1, minSize: 1 }, gutterEntry(PAD_RIGHT)],
			gap: 0,
			align: "stretch",
		};
	};
	root[FULLSCREEN_LAYOUT_PATCHED] = true;
	tui.requestRender?.(true);
	return true;
}

export function installTuiPadding(tui: AnyComponent): void {
	if (installFullscreenTuiPadding(tui)) return;
	const state = tui as any;
	if (state[PATCHED]) return;
	state[PATCHED] = true;
	state[ORIGINAL_RENDER] ??= getOriginalTuiMethod(tui, "render");

	const paddedTuiRender = function paddedTuiRender(this: unknown, width: number): string[] {
		const innerWidth = getTuiContentInnerWidth(width);
		const lines = (state[ORIGINAL_RENDER] as (w: number) => string[]).call(this, innerWidth);
		return lines.map((line: string) => padTuiContentLine(line, width));
	};
	tui.render = paddedTuiRender;
	rememberTuiMethodWrapper(tui, "render", paddedTuiRender);
}
