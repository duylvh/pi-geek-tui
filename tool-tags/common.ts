import type { AgentToolResult, ToolRenderResultOptions } from "@earendil-works/pi-coding-agent";
import { relative, resolve } from "node:path";


export function isExpanded(options: ToolRenderResultOptions): boolean {
	return typeof options?.expanded === "boolean" ? options.expanded : false;
}

function resolveAbsolutePath(rawPath: string, cwd: string): string {
	const path = rawPath.trim();
	if (!path) return "";

	const home = process.env.HOME;
	if (home && (path === "~" || path.startsWith("~/"))) {
		return path === "~" ? home : resolve(home, path.slice(2));
	}

	return resolve(cwd, path);
}

export function resolveRelativePath(rawPath: string, cwd: string): string {
	const absPath = resolveAbsolutePath(rawPath, cwd);
	if (!absPath) return "(unknown)";
	const relPath = relative(cwd, absPath).replace(/\\/g, "/");
	return relPath || ".";
}

export function replaceTabs(text: string): string {
	return text.replace(/\t/g, "   ");
}

export function getTextOutput(result: AgentToolResult<any> | undefined): string {
	if (!result?.content) return "";
	const textBlocks = result.content.filter((contentBlock: any) => contentBlock.type === "text");
	return textBlocks.map((contentBlock: any) => String(contentBlock.text ?? "")).join("\n").replace(/\r/g, "");
}

export function stripTrailingNotice(text: string): string {
	const normalized = (text ?? "").replace(/\r/g, "").trimEnd();
	if (!normalized) return "";
	if (normalized.startsWith("[") && normalized.endsWith("]")) return "";
	const noticeStart = normalized.lastIndexOf("\n\n[");
	if (noticeStart >= 0 && normalized.endsWith("]")) {
		return normalized.slice(0, noticeStart).trimEnd();
	}
	return normalized;
}

export function extractTrailingNotice(text: string): string | null {
	const normalized = (text ?? "").replace(/\r/g, "").trimEnd();
	if (!normalized) return null;
	if (normalized.startsWith("[") && normalized.endsWith("]")) return normalized;
	const noticeStart = normalized.lastIndexOf("\n\n[");
	if (noticeStart >= 0 && normalized.endsWith("]")) {
		return normalized.slice(noticeStart + 2).trimEnd();
	}
	return null;
}
