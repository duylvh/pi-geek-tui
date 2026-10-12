// Live agent state shown on the right of the input head row (spec §8).
// Driven from the agent/message/tool events in index.ts.

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

/** Which live state an in-progress assistant message is in: tool call → running, answer text → answering, else thinking. */
export function workingStateForAssistantMessage(message: unknown): LiveStateName {
	const content = (message as { content?: unknown }).content;
	if (!Array.isArray(content)) return "thinking";
	let hasAnswerText = false;
	for (const item of content) {
		if (!item || typeof item !== "object") continue;
		const part = item as { type?: unknown; text?: unknown };
		if (part.type === "toolCall") return "running";
		if (part.type === "text" && typeof part.text === "string" && part.text.trim().length > 0) hasAnswerText = true;
	}
	return hasAnswerText ? "answering" : "thinking";
}
