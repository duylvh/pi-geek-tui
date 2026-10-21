const PATCHED = Symbol.for("pi-geek-tui.exit-ui.patched");

type ExitUiOwner = {
	renderer: { mode: string };
};
type ExitOutput = "transcript" | "resume-hint";
type StopInteractiveTui = (this: ExitUiOwner, output?: ExitOutput) => void;

export function installExitUiPatch(InteractiveModeComponent: { prototype: object }): void {
	const proto: { stopInteractiveTui?: StopInteractiveTui; [PATCHED]?: boolean } = InteractiveModeComponent.prototype;
	const original = proto.stopInteractiveTui;
	if (proto[PATCHED] || typeof original !== "function") return;
	proto[PATCHED] = true;
	proto.stopInteractiveTui = function stopWithoutTranscript(output) {
		return original.call(this, this.renderer.mode === "fullscreen" ? "resume-hint" : output);
	};
}
