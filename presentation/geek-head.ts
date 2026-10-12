// Message head row data (spec §2): `bean@kpi-api ~/code/kpi-api (fix/refresh-ttl)` / `pi@agent …`.
import { existsSync, readFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { type GeekHeadInfo, type GeekRail, geekHeadBody, geekRow } from "./geek-rows.js";

const BRANCH_TTL_MS = 2000;
let branchCache: { cwd: string; at: number; branch?: string } | undefined;

function findGitDir(cwd: string): string | undefined {
	for (let dir = cwd; ; dir = dirname(dir)) {
		const dotGit = join(dir, ".git");
		if (existsSync(dotGit)) {
			// A worktree/submodule `.git` is a file pointing at the real git dir; a normal one is a directory.
			let pointer: RegExpExecArray | null = null;
			try {
				pointer = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, "utf8"));
			} catch {
				return dotGit;
			}
			return pointer ? (isAbsolute(pointer[1]!) ? pointer[1]! : resolve(dir, pointer[1]!)) : undefined;
		}
		if (dirname(dir) === dir) return undefined;
	}
}

/** Current branch (or short sha when detached) read straight from `.git/HEAD`; cached briefly. */
export function readGitBranch(cwd = process.cwd()): string | undefined {
	const now = Date.now();
	if (branchCache && branchCache.cwd === cwd && now - branchCache.at < BRANCH_TTL_MS) return branchCache.branch;
	let branch: string | undefined;
	try {
		const gitDir = findGitDir(cwd);
		const head = gitDir ? readFileSync(join(gitDir, "HEAD"), "utf8").trim() : "";
		branch = head.startsWith("ref: refs/heads/") ? head.slice("ref: refs/heads/".length) : head.slice(0, 7) || undefined;
	} catch {
		branch = undefined;
	}
	branchCache = { cwd, at: now, branch };
	return branch;
}

function tildePath(cwd: string): string {
	const home = homedir();
	return cwd === home ? "~" : cwd.startsWith(`${home}/`) ? `~${cwd.slice(home.length)}` : cwd;
}

export type GeekRole = "user" | "agent";

/** user → `<login>@<project dir>`; agent → `pi@agent`. */
export function getGeekHeadInfo(role: GeekRole, cwd = process.cwd()): GeekHeadInfo {
	const name = role === "agent" ? "pi" : safeLogin();
	return { name, host: role === "agent" ? "agent" : basename(cwd) || "~", cwd: tildePath(cwd), branch: readGitBranch(cwd) };
}

function safeLogin(): string {
	try {
		return userInfo().username || "user";
	} catch {
		return "user";
	}
}

export function geekHeadRow(role: GeekRole, width: number): string {
	const rail: GeekRail = role === "agent" ? "head-agent" : "head-user";
	return geekRow(rail, geekHeadBody(getGeekHeadInfo(role)), width);
}
