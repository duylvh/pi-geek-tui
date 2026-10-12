import { Markdown } from "@earendil-works/pi-tui";

import { geekNumber } from "../presentation/geek-rows.js";
import { geekFg } from "../theme/geek-palette.js";
import { getMessageTimestamp } from "./message-meta.js";
import { renderRailMessageBlock } from "./rail-message-block.js";

const PATCH_FLAG = "__geekCoreMessageBlocksPatched__";
const EXPAND_HINT = `${geekFg("faint", "^o")} ${geekFg("dim", "expand")}`;

/** Pi's own theme, only needed to hand to extension-supplied custom message renderers. */
let cachedTheme: any = null;

export function setCoreMessageBlockTheme(theme: any): void {
	cachedTheme = theme;
}

type ComponentCtor = { prototype?: any };

export function installCoreMessageBlockStyling(ctors: {
	CompactionSummaryMessageComponent?: ComponentCtor;
	SkillInvocationMessageComponent?: ComponentCtor;
	BranchSummaryMessageComponent?: ComponentCtor;
	CustomMessageComponent?: ComponentCtor;
}): void {
	const globalState = globalThis as Record<string, unknown>;
	if (globalState[PATCH_FLAG]) return;
	globalState[PATCH_FLAG] = true;

	patchBoxBlock(ctors.CompactionSummaryMessageComponent, (c) =>
		c.message?.tokensBefore == null
			? null
			: { kind: "compaction", title: `${geekNumber(Number(c.message.tokensBefore))} tokens`, text: c.message.summary },
	);
	patchBoxBlock(ctors.SkillInvocationMessageComponent, (c) =>
		c.skillBlock?.name ? { kind: "skill", title: c.skillBlock.name, text: c.skillBlock.content } : null,
	);
	patchBoxBlock(ctors.BranchSummaryMessageComponent, (c) => (c.message == null ? null : { kind: "branch", text: c.message.summary }));
	patchCustomMessage(ctors.CustomMessageComponent);
}

function markdownBody(text: unknown, markdownTheme: any): (bodyWidth: number) => string[] {
	if (typeof text !== "string" || !text || !markdownTheme) return () => [];
	const md = new Markdown(text, 0, 0, markdownTheme);
	return (bodyWidth) => md.render(bodyWidth);
}

/** The rail block replaces Pi's tinted box: no padding, no background. */
function flattenBox(box: any): void {
	box.paddingX = 0;
	box.paddingY = 0;
	box.setBgFn?.((text: string) => text);
}

type BlockInfo = { kind: string; title?: string; text?: unknown };

function patchBoxBlock(ctor: ComponentCtor | undefined, describe: (component: any) => BlockInfo | null): void {
	const proto = ctor?.prototype;
	if (!proto || typeof proto.updateDisplay !== "function") return;

	const base = proto.updateDisplay;
	proto.updateDisplay = function patchedBlockUpdateDisplay(this: any) {
		const info = describe(this);
		if (!info) return base.call(this);

		flattenBox(this);
		this.clear();
		const expanded = Boolean(this.expanded);
		this.addChild(
			renderRailMessageBlock({
				kind: info.kind,
				title: info.title,
				right: expanded ? undefined : EXPAND_HINT,
				timestamp: getMessageTimestamp(this) ?? this.message?.timestamp,
				body: expanded ? markdownBody(info.text, this.markdownTheme) : () => [],
			}),
		);
	};
}

function messageText(message: any): string {
	if (typeof message?.content === "string") return message.content;
	if (!Array.isArray(message?.content)) return "";
	return message.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n");
}

function patchCustomMessage(ctor?: ComponentCtor): void {
	const proto = ctor?.prototype;
	if (!proto || typeof proto.rebuild !== "function") return;

	const base = proto.rebuild;
	proto.rebuild = function patchedCustomMessageRebuild(this: any) {
		if (this.customComponent) {
			this.removeChild(this.customComponent);
			this.customComponent = undefined;
		}
		this.removeChild(this.box);

		const kind = this.message?.customType || "custom";
		const timestamp = getMessageTimestamp(this) ?? this.message?.timestamp;

		// Extension renderers keep their own content; the rail block supplies the shell.
		if (this.customRenderer && cachedTheme) {
			try {
				const component = this.customRenderer(this.message, { expanded: this._expanded }, cachedTheme);
				if (component && typeof component.render === "function") {
					this.customComponent = renderRailMessageBlock({ kind, timestamp, body: (bodyWidth) => component.render(bodyWidth) });
					this.addChild(this.customComponent);
					return;
				}
			} catch {
				// Fall through to default rendering.
			}
		}

		flattenBox(this.box);
		this.addChild(this.box);
		this.box.clear();
		this.box.addChild(renderRailMessageBlock({ kind, timestamp, body: markdownBody(messageText(this.message), this.markdownTheme) }));
	};
}
