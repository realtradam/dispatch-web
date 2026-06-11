import type { LspServerInfo, LspServerState } from "@dispatch/transport-contract";

/**
 * Pure core for the workspace feature — zero DOM, zero effects, zero Svelte.
 *
 * The workspace feature exposes a conversation's per-tab working directory (cwd)
 * and the live status of the language servers configured for that cwd. This
 * module holds the pure logic: cwd normalization/validation, the mapping of a
 * backend `LspServerState` to a display badge, and a one-line server summary.
 * The effects (the HTTP get/set cwd + get LSP status) are INJECTED via the ports
 * below; the composition root implements them.
 */

// ── Injected ports (consumer-defines-port; the composition root adapts the
//    store's HTTP calls to these shapes). ──────────────────────────────────────

/** Outcome of `PUT /conversations/:id/cwd`; `null` when no real conversation is focused. */
export type CwdSaveResult =
	| { readonly ok: true; readonly cwd: string | null }
	| { readonly ok: false; readonly error: string };

export type SaveCwd = (cwd: string) => Promise<CwdSaveResult | null>;

/** Outcome of `GET /conversations/:id/lsp`; `null` when no real conversation is focused. */
export type LspStatusResult =
	| { readonly ok: true; readonly cwd: string | null; readonly servers: readonly LspServerInfo[] }
	| { readonly ok: false; readonly error: string };

export type LoadLspStatus = () => Promise<LspStatusResult | null>;

// ── cwd helpers ───────────────────────────────────────────────────────────────

/** Trim surrounding whitespace; the backend rejects an empty cwd. */
export function normalizeCwd(raw: string): string {
	return raw.trim();
}

/** Whether a typed cwd is submittable (non-empty after trim). */
export function isSubmittableCwd(raw: string): boolean {
	return normalizeCwd(raw).length > 0;
}

/**
 * Whether saving `typed` would change the persisted `current` cwd. A no-op save
 * (unchanged, or empty) should be disabled.
 */
export function cwdChanged(typed: string, current: string | null): boolean {
	const next = normalizeCwd(typed);
	if (next.length === 0) return false;
	return next !== (current ?? "");
}

// ── LSP server status → display view ──────────────────────────────────────────

export type Badge = "success" | "warning" | "error" | "neutral";

export interface LspServerView {
	readonly id: string;
	readonly name: string;
	readonly root: string;
	/** Space-joined extension list, e.g. ".ts .tsx". */
	readonly extensionsLabel: string;
	readonly state: LspServerState;
	readonly statusLabel: string;
	readonly badge: Badge;
	/** True while the state is transient (show a spinner). */
	readonly busy: boolean;
	/** The error reason when `state === "error"`, else null. */
	readonly error: string | null;
}

/** Map a server's state to a display label + badge severity + busy flag. */
export function viewLspServer(server: LspServerInfo): LspServerView {
	let statusLabel: string;
	let badge: Badge;
	let busy = false;
	switch (server.state) {
		case "connected":
			statusLabel = "Connected";
			badge = "success";
			break;
		case "starting":
			statusLabel = "Starting…";
			badge = "warning";
			busy = true;
			break;
		case "not-started":
			statusLabel = "Not started";
			badge = "neutral";
			busy = true;
			break;
		case "error":
			statusLabel = "Error";
			badge = "error";
			break;
	}
	return {
		id: server.id,
		name: server.name,
		root: server.root,
		extensionsLabel: server.extensions.join(" "),
		state: server.state,
		statusLabel,
		badge,
		busy,
		error: server.state === "error" ? (server.error ?? "Failed to start") : null,
	};
}

export function viewLspServers(servers: readonly LspServerInfo[]): readonly LspServerView[] {
	return servers.map(viewLspServer);
}

/** A short one-line summary, e.g. "2 connected" / "1 connected, 1 error". */
export function summarizeServers(servers: readonly LspServerInfo[]): string {
	if (servers.length === 0) return "No language servers";
	let connected = 0;
	let errored = 0;
	let pending = 0;
	for (const s of servers) {
		if (s.state === "connected") connected++;
		else if (s.state === "error") errored++;
		else pending++;
	}
	const parts: string[] = [];
	if (connected > 0) parts.push(`${connected} connected`);
	if (pending > 0) parts.push(`${pending} starting`);
	if (errored > 0) parts.push(`${errored} error${errored === 1 ? "" : "s"}`);
	return parts.join(", ");
}
