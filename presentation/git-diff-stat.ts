// Working-tree diff stats (`files +added -removed`) for the input head row.
// Never runs git from a render path: renders read the cache via getGitDiffStat(); refreshGitDiffStat()
// is called from events (session start, agent end, edit/write/bash end, input submit).

import { execFile } from "node:child_process";

export interface GitDiffStat {
	files: number;
	added: number;
	removed: number;
}

const DEBOUNCE_MS = 300;
const TIMEOUT_MS = 1500;
const MAX_BUFFER = 16 * 1024 * 1024;
const GIT_ENV = { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" };

type GitResult = { ok: true; out: string } | { ok: false; code: unknown };

function git(cwd: string, args: string[], timeoutMs: number): Promise<GitResult> {
	return new Promise((resolve) => {
		try {
			execFile(
				"git",
				args,
				{ cwd, env: GIT_ENV, timeout: timeoutMs, killSignal: "SIGKILL", maxBuffer: MAX_BUFFER, windowsHide: true },
				(error, stdout) => resolve(error ? { ok: false, code: (error as { code?: unknown }).code } : { ok: true, out: String(stdout) }),
			);
		} catch {
			resolve({ ok: false, code: "spawn" });
		}
	});
}

/** Sum `git diff --numstat` lines into per-path totals; binary files (`-\t-`) count as files only. */
function addNumstat(out: string, into: Map<string, { added: number; removed: number }>): void {
	for (const line of out.split("\n")) {
		const [added, removed, ...rest] = line.split("\t");
		const path = rest.join("\t");
		if (!path) continue;
		const entry = into.get(path) ?? { added: 0, removed: 0 };
		entry.added += Number.parseInt(added ?? "", 10) || 0;
		entry.removed += Number.parseInt(removed ?? "", 10) || 0;
		into.set(path, entry);
	}
}

/**
 * One uncached read. `null` = not a repo or clean; `undefined` = could not tell (timeout, git missing…),
 * so callers keep their last good value.
 */
export async function readGitDiffStat(cwd: string, timeoutMs = TIMEOUT_MS): Promise<GitDiffStat | null | undefined> {
	const [head, untracked] = await Promise.all([
		git(cwd, ["diff", "HEAD", "--numstat"], timeoutMs),
		git(cwd, ["ls-files", "--others", "--exclude-standard", "-z"], timeoutMs),
	]);
	// `git diff` outside a repo silently becomes a no-index diff, so ls-files decides "not a repo" (exit 128).
	if (!untracked.ok) return untracked.code === 128 ? null : undefined;
	const files = new Map<string, { added: number; removed: number }>();
	if (head.ok) {
		addNumstat(head.out, files);
	} else {
		// No HEAD yet (fresh repo): staged + unstaged separately.
		const [staged, worktree] = await Promise.all([
			git(cwd, ["diff", "--cached", "--numstat"], timeoutMs),
			git(cwd, ["diff", "--numstat"], timeoutMs),
		]);
		if (!staged.ok && !worktree.ok) return undefined;
		if (staged.ok) addNumstat(staged.out, files);
		if (worktree.ok) addNumstat(worktree.out, files);
	}

	let added = 0;
	let removed = 0;
	for (const entry of files.values()) {
		added += entry.added;
		removed += entry.removed;
	}
	const total = files.size + untracked.out.split("\0").filter(Boolean).length;
	return total === 0 ? null : { files: total, added, removed };
}

type CacheEntry = {
	value: GitDiffStat | null;
	timer?: ReturnType<typeof setTimeout>;
	inFlight: boolean;
	again: boolean;
	onChange?: () => void;
};

const cache = new Map<string, CacheEntry>();

function sameStat(a: GitDiffStat | null, b: GitDiffStat | null): boolean {
	return a === b || (a !== null && b !== null && a.files === b.files && a.added === b.added && a.removed === b.removed);
}

async function run(cwd: string, entry: CacheEntry): Promise<void> {
	if (entry.inFlight) {
		entry.again = true;
		return;
	}
	entry.inFlight = true;
	try {
		const next = await readGitDiffStat(cwd);
		if (next !== undefined && !sameStat(entry.value, next)) {
			entry.value = next;
			entry.onChange?.();
		}
	} catch {
		// Keep the last value; stats are decoration.
	} finally {
		entry.inFlight = false;
		if (entry.again) {
			entry.again = false;
			schedule(cwd, entry);
		}
	}
}

function schedule(cwd: string, entry: CacheEntry): void {
	if (entry.timer) clearTimeout(entry.timer);
	entry.timer = setTimeout(() => {
		entry.timer = undefined;
		void run(cwd, entry);
	}, DEBOUNCE_MS);
	entry.timer.unref?.();
}

/** Cached stats for `cwd`; null until the first refresh lands, and for clean trees / non-repos. Safe in render. */
export function getGitDiffStat(cwd: string): GitDiffStat | null {
	return cache.get(cwd)?.value ?? null;
}

/**
 * Ask for a fresh value: debounced (300ms), one git run in flight per cwd, 1.5s timeout.
 * `onChange` (usually `tui.requestRender`) fires only when the value actually changed; the latest one wins.
 */
export function refreshGitDiffStat(cwd: string, onChange?: () => void): void {
	let entry = cache.get(cwd);
	if (!entry) {
		entry = { value: null, inFlight: false, again: false };
		cache.set(cwd, entry);
	}
	if (onChange) entry.onChange = onChange;
	schedule(cwd, entry);
}
