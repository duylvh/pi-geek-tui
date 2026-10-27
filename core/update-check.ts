import { DefaultPackageManager, SettingsManager, VERSION, getAgentDir } from "@earendil-works/pi-coding-agent";

export interface AvailableUpdates {
	pi?: string;
	packages: string[];
}

const LATEST_VERSION_URL = "https://pi.dev/api/latest-version";

function parseVersion(version: string): [number, number, number] | undefined {
	const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version);
	return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined;
}

function isNewer(latest: string, current: string): boolean {
	const a = parseVersion(latest);
	const b = parseVersion(current);
	if (!a || !b) return latest !== current;
	for (let i = 0; i < 3; i++) {
		if (a[i] !== b[i]) return a[i] > b[i];
	}
	return false;
}

// Pi does not export its startup version check from the package root, so this mirrors it.
async function checkPiVersion(): Promise<string | undefined> {
	if (process.env.PI_OFFLINE || process.env.PI_SKIP_VERSION_CHECK) return undefined;
	try {
		const response = await fetch(LATEST_VERSION_URL, {
			headers: { accept: "application/json" },
			signal: AbortSignal.timeout(10_000),
		});
		if (!response.ok) return undefined;
		const data = (await response.json()) as { version?: unknown };
		const latest = typeof data.version === "string" ? data.version.trim() : "";
		return latest && isNewer(latest, VERSION) ? latest : undefined;
	} catch {
		return undefined;
	}
}

async function checkPackageUpdates(cwd: string): Promise<string[]> {
	if (process.env.PI_OFFLINE) return [];
	try {
		const agentDir = getAgentDir();
		const manager = new DefaultPackageManager({ cwd, agentDir, settingsManager: SettingsManager.create(cwd, agentDir) });
		return (await manager.checkForAvailableUpdates()).map((update) => update.displayName);
	} catch {
		return [];
	}
}

export async function checkAvailableUpdates(cwd: string): Promise<AvailableUpdates> {
	const [pi, packages] = await Promise.all([checkPiVersion(), checkPackageUpdates(cwd)]);
	return pi ? { pi, packages } : { packages };
}

export function formatUpdateNotice(updates: AvailableUpdates): string | undefined {
	const lines: string[] = [];
	if (updates.pi) lines.push(`Pi ${updates.pi} is available. Run pi update`);
	if (updates.packages.length > 0) {
		lines.push("Package updates are available. Run pi update --extensions", ...updates.packages.map((name) => `- ${name}`));
	}
	return lines.length > 0 ? lines.join("\n") : undefined;
}
