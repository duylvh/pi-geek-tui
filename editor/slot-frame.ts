// Whatever Pi puts in the editor slot besides our GeekEditor (settings/model/session/tree selectors,
// extension select/input/editor dialogs, login boxes…) gets the same grammar as the rest of the UI:
// 8 blank prefix cells + a panel body (slash-menu look), never wider than its width.
//
// One seam: InteractiveMode swaps `editorContainer`'s children for every selector, so the container's
// render is patched once. GeekEditor (marked) renders its own grammar rows and passes through.
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { GEEK_PREFIX_WIDTH } from "../presentation/geek-rows.js";
import { geekBg, geekFg } from "../theme/geek-palette.js";

/** Components that already render grammar rows (GeekEditor) set this on their prototype. */
export const OWN_EDITOR_ROWS = Symbol.for("pi-geek-tui.slot-frame.own-rows");
const PATCHED = Symbol.for("pi-geek-tui.slot-frame.patched");

const SGR = /\x1b\[[0-9;]*m/g;
const FULL_RESET = /\x1b\[0?m/g;
const BG_RESET = /\x1b\[49m/g;
const MARKER = /^((?:\x1b\[[0-9;]*m| )*)→ /;

function bgStart(): string {
	return geekBg("panel", "\0").split("\0")[0]!;
}

function inkStart(): string {
	return geekFg("ink", "\0").split("\0")[0]!;
}

/** A row made only of border strokes (Pi's DynamicBorder) — the panel has no stock borders. */
function isBorderRow(row: string): boolean {
	const plain = row.replace(SGR, "");
	return plain.length > 0 && /^[─\s]+$/.test(plain) && plain.includes("─");
}

/** One body row on the panel: clamped to `bodyWidth`, `→ ` marker as `› `, panel bg surviving the row's own SGR resets. */
function panelRow(row: string, bodyWidth: number): string {
	const clamped = truncateToWidth(row.replace(MARKER, "$1› "), bodyWidth, "", true);
	const bg = bgStart();
	const survives = clamped.replace(FULL_RESET, (reset) => `${reset}${bg}${inkStart()}`).replace(BG_RESET, (reset) => `${reset}${bg}`);
	return `${bg}${inkStart()}${survives}\x1b[49m\x1b[39m`;
}

/** Rows for a foreign slot child: exactly `width` cells each. */
export function frameSlotChild(child: { render(width: number): string[] }, width: number): string[] {
	const total = Math.max(0, Math.floor(width));
	if (total <= GEEK_PREFIX_WIDTH) return child.render(total).map((row) => truncateToWidth(row, total, "", true));
	const bodyWidth = total - GEEK_PREFIX_WIDTH;
	const prefix = " ".repeat(GEEK_PREFIX_WIDTH);
	return child.render(bodyWidth).map((row) => prefix + panelRow(isBorderRow(row) ? "" : row, bodyWidth));
}

type RenderableContainer = { children: any[]; render(width: number): string[] };

function patchContainer(container: RenderableContainer | undefined): void {
	if (!container || (container as any)[PATCHED]) return;
	(container as any)[PATCHED] = true;
	const baseRender = container.render.bind(container);
	container.render = (width: number): string[] => {
		const children = container.children;
		if (children.every((child) => child?.[OWN_EDITOR_ROWS])) return baseRender(width);
		return children.flatMap((child) => (child?.[OWN_EDITOR_ROWS] ? child.render(width) : frameSlotChild(child, width)));
	};
}

/** Frames the editor slot. Must be installed before our editor is set (which creates the patched container's first swap). */
export function installEditorSlotFrame(InteractiveModeClass: any): void {
	const proto = InteractiveModeClass?.prototype;
	if (!proto || proto[PATCHED] || typeof proto.setCustomEditorComponent !== "function") return;
	proto[PATCHED] = true;
	const base = proto.setCustomEditorComponent;
	proto.setCustomEditorComponent = function patchedSetCustomEditorComponent(this: any, ...args: any[]): unknown {
		patchContainer(this.editorContainer);
		return base.apply(this, args);
	};
}
