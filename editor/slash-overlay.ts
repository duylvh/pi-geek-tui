import type { Component, OverlayHandle, OverlayOptions, TuiMouseEvent, TuiMouseEventResult } from "@earendil-works/pi-tui";
import { getOriginalTuiMethod, rememberTuiMethodWrapper } from "../performance/tui-proxy-original.js";
import { renderSlashMenu, type SlashMenuModel } from "./slash-menu.js";

/** What the editor hands the floating panel in a frame it rendered: the menu, the editor's render width and its row count. */
export type SlashFrame = { model: SlashMenuModel; hints: Record<string, string>; width: number; bodyRows: number };

type MenuList = { handleMouse?: (event: TuiMouseEvent) => TuiMouseEventResult | undefined };
type LayoutBox = { component: unknown; rect: { x: number; y: number; width: number; height: number }; children: LayoutBox[]; scrollView?: unknown };

/**
 * Slash-panel mouse → the autocomplete list (Pi's own select/click/wheel semantics): an item row (row 0 is the
 * header) goes to the list as its local row; a wheel anywhere on the panel moves the selection.
 */
export function routeSlashMenuMouse(list: MenuList | undefined, event: TuiMouseEvent, itemRows: number): TuiMouseEventResult | undefined {
	const index = event.y - 1;
	const onItem = index >= 0 && index < itemRows;
	if (!list?.handleMouse || (!onItem && event.type !== "wheel")) return undefined;
	return list.handleMouse({ ...event, y: onItem ? index : 0, height: itemRows });
}

const CONTENT_FRAMES = Symbol.for("pi-geek-tui.slash-overlay.content-frames");
const COUNTING = Symbol.for("pi-geek-tui.slash-overlay.counting");

/**
 * Counts the frames that render components. Pi (>= 1.6) paints view-only frames (scroll, selection) from the last
 * frame's output without calling render(), so the editor hands no new frame and its last one still holds.
 */
function countContentFrames(tui: any): void {
	if (tui[COUNTING]) return;
	tui[COUNTING] = true;
	const baseDoRender = getOriginalTuiMethod(tui, "doRender");
	const countingDoRender = function (this: any, ...args: unknown[]): unknown {
		if (this.contentChanged !== false) this[CONTENT_FRAMES] = (this[CONTENT_FRAMES] ?? 0) + 1;
		return baseDoRender.call(this, ...args);
	};
	tui.doRender = countingDoRender;
	rememberTuiMethodWrapper(tui, "doRender", countingDoRender);
}

/** The layout box drawing `editor`: its own, or the container it is the child of (Pi's editor slot). */
function findEditorBox(box: LayoutBox, editor: object): LayoutBox | undefined {
	const children = (box.component as { children?: unknown }).children;
	if (box.component === editor || (Array.isArray(children) && children.includes(editor))) return box;
	if (box.scrollView) return undefined;
	for (const child of box.children) {
		const found = findEditorBox(child, editor);
		if (found) return found;
	}
	return undefined;
}

/**
 * Fullscreen slash menu: a non-capturing overlay on the transcript rows right above the editor's head row, so
 * opening it neither grows the editor nor moves the transcript. The overlay exists only while the editor hands
 * it a frame in every content frame. Without one (menu closed, editor replaced or covered by a selector) it
 * removes itself: Pi refuses to switch TUI mode while any overlay entry exists, hidden or not.
 */
export class SlashOverlay implements Component {
	private handle: OverlayHandle | undefined;
	private frame: SlashFrame | undefined;
	private frameId: number | undefined;
	private itemRows = 0;
	// Pi re-reads these on every composite, so updating the object in place moves the panel.
	private readonly options: OverlayOptions = { nonCapturing: true, anchor: "bottom-left", maxHeight: "100%" };

	constructor(
		private readonly tui: any,
		private readonly editor: object,
		private readonly list: () => MenuList | undefined,
	) {}

	/** Called by the editor's render in every fullscreen frame: the menu to show, or undefined once it closed. */
	show(frame: SlashFrame | undefined): void {
		if (!frame) return this.close();
		countContentFrames(this.tui);
		this.frame = frame;
		this.frameId = this.tui[CONTENT_FRAMES];
		// The previous frame's layout: overlays composite before Pi stores this frame's.
		const layout = this.tui.currentLayout as { root?: LayoutBox; height: number } | undefined;
		const box = layout?.root ? findEditorBox(layout.root, this.editor) : undefined;
		const rowsBelow = box && layout ? Math.max(0, layout.height - (box.rect.y + box.rect.height)) : 0;
		Object.assign(this.options, { col: box?.rect.x ?? 0, width: frame.width, margin: { bottom: frame.bodyRows + rowsBelow } });
		this.handle ??= this.tui.showOverlay(this, this.options);
	}

	render(width: number): string[] {
		const frame = this.frameId === this.tui[CONTENT_FRAMES] ? this.frame : undefined;
		if (!frame) {
			this.close();
			return [];
		}
		const rows = renderSlashMenu(frame.model, width, frame.hints);
		this.itemRows = frame.model.items.length > 0 ? rows.length - 2 : 0;
		return rows;
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		const result = routeSlashMenuMouse(this.list(), event, this.itemRows);
		// A focus result would move the keyboard from the editor to this overlay.
		return result && { ...result, focus: false };
	}

	invalidate(): void {}

	private close(): void {
		this.handle?.hide();
		this.handle = undefined;
		this.frame = undefined;
	}
}
