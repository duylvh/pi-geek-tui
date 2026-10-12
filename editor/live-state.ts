// Live agent state shown on the right of the input head row (spec §8).
// Fed by mirroring the working-loader controller, so it follows the same state machine.

export type LiveStateName = "working" | "thinking" | "answering" | "running";

type LiveState = { name: LiveStateName; startedAt: number };

const STATE_KEY = Symbol.for("pi-geek-tui.live-state");
const runtime = globalThis as Record<PropertyKey, unknown>;

function read(): LiveState | undefined {
	return runtime[STATE_KEY] as LiveState | undefined;
}

export function setLiveState(name: LiveStateName | undefined): void {
	const current = read();
	if (!name) runtime[STATE_KEY] = undefined;
	else if (!current) runtime[STATE_KEY] = { name, startedAt: Date.now() };
	else current.name = name;
}

export function getLiveState(): { name: LiveStateName; elapsedMs: number } | undefined {
	const current = read();
	return current ? { name: current.name, elapsedMs: Date.now() - current.startedAt } : undefined;
}

type LoaderLike = {
	start(state?: LiveStateName): void;
	setState(state: LiveStateName): void;
	stop(): void;
	dispose(): void;
};

/** Same controller, but every transition is also recorded in the live state. */
export function mirrorLiveState<T extends LoaderLike>(controller: T): T {
	return {
		...controller,
		start(state: LiveStateName = "working") {
			setLiveState(state);
			controller.start(state);
		},
		setState(state: LiveStateName) {
			setLiveState(state);
			controller.setState(state);
		},
		stop() {
			setLiveState(undefined);
			controller.stop();
		},
		dispose() {
			setLiveState(undefined);
			controller.dispose();
		},
	};
}
