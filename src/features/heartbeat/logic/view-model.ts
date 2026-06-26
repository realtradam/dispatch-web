import type { ReasoningEffort } from "@dispatch/transport-contract";
import {
	DEFAULT_REASONING_EFFORT,
	effectiveEffort,
	effortOptions,
} from "../../chat/reasoning-effort";
import type {
	HeartbeatConfig,
	HeartbeatConfigPatch,
	HeartbeatRun,
	HeartbeatRunStatus,
} from "./types";

/**
 * Pure view-models for the heartbeat feature — zero DOM, zero effects, zero
 * Svelte. Maps backend `HeartbeatConfig`/`HeartbeatRun` to display shapes
 * (badges, labels, formatted times) and holds the config-form helpers.
 *
 * The reasoning-effort ladder + resolution are SERVER-owned and shared with the
 * per-conversation knob, so they are REUSED from `features/chat/reasoning-effort`
 * (a sanctioned cross-feature import through its public exports) rather than
 * redefined — no drift.
 */

export type Badge = "success" | "warning" | "error" | "neutral";

/** A run shaped for display in the scrolling runs list. */
export interface HeartbeatRunView {
	readonly id: string;
	readonly conversationId: string;
	readonly status: HeartbeatRunStatus;
	readonly statusLabel: string;
	readonly badge: Badge;
	/** True while the run is in flight (show a spinner). */
	readonly busy: boolean;
	/** A short absolute clock label, e.g. "14:30:05". */
	readonly timeLabel: string;
	/** A relative label, e.g. "5m ago" / "just now". */
	readonly relativeLabel: string;
}

const RUNNING_LABEL = "Running";
const COMPLETED_LABEL = "Completed";
const STOPPED_LABEL = "Stopped";

/**
 * Map a run's status to a display badge + busy flag. `running` → warning +
 * spinner, `completed` → success, `stopped` → neutral. Mirrors the LSP/MCP
 * status visual treatment.
 */
export function badgeForStatus(status: HeartbeatRunStatus): { badge: Badge; busy: boolean } {
	switch (status) {
		case "running":
			return { badge: "warning", busy: true };
		case "completed":
			return { badge: "success", busy: false };
		case "stopped":
			return { badge: "neutral", busy: false };
	}
}

export function statusLabelFor(status: HeartbeatRunStatus): string {
	switch (status) {
		case "running":
			return RUNNING_LABEL;
		case "completed":
			return COMPLETED_LABEL;
		case "stopped":
			return STOPPED_LABEL;
	}
}

/**
 * Format an ISO timestamp as a short absolute clock label (HH:MM:SS) in the
 * viewer's locale. Returns "—" for an unparseable timestamp so the UI never
 * crashes on a malformed backend value. Pure (no `now` needed — an absolute
 * clock label doesn't depend on the current time).
 */
export function formatRunTime(triggeredAt: string): string {
	const t = parseTime(triggeredAt);
	if (t === null) return "—";
	return clockLabel(t);
}

/**
 * A coarse relative label — "just now" (<1m), "Nm ago", "Nh ago", else the
 * absolute date+time (so an old run reads "Jun 24, 14:30"). Pure via `now`.
 */
export function relativeLabel(triggeredAt: string, now: number = Date.now()): string {
	const t = parseTime(triggeredAt);
	if (t === null) return "—";
	const deltaMs = now - t;
	if (deltaMs < 0) return "just now";
	const mins = Math.floor(deltaMs / 60000);
	if (mins < 1) return "just now";
	if (mins < 60) return `${mins}m ago`;
	const hours = Math.floor(mins / 60);
	if (hours < 24) return `${hours}h ago`;
	return dateLabel(t);
}

/**
 * Build a display view for a run. `now` is injectable for tests (defaults to
 * `Date.now()`); the composition-root component passes nothing in production.
 */
export function viewRun(run: HeartbeatRun, now: number = Date.now()): HeartbeatRunView {
	const { badge, busy } = badgeForStatus(run.status);
	return {
		id: run.id,
		conversationId: run.conversationId,
		status: run.status,
		statusLabel: statusLabelFor(run.status),
		badge,
		busy,
		timeLabel: formatRunTime(run.triggeredAt),
		relativeLabel: relativeLabel(run.triggeredAt, now),
	};
}

export function viewRuns(
	runs: readonly HeartbeatRun[],
	now: number = Date.now(),
): readonly HeartbeatRunView[] {
	return runs.map((r) => viewRun(r, now));
}

// ── Time formatting (pure: no `Date` mutation; injectable `now` for tests) ─────

/** Parse an ISO timestamp to epoch ms, or null if unparseable. */
function parseTime(iso: string): number | null {
	if (typeof iso !== "string" || iso.length === 0) return null;
	const t = Date.parse(iso);
	return Number.isNaN(t) ? null : t;
}

/** `HH:MM:SS` in the viewer's locale (24h where the locale uses it). */
function clockLabel(epochMs: number): string {
	const d = new Date(epochMs);
	const hh = String(d.getHours()).padStart(2, "0");
	const mm = String(d.getMinutes()).padStart(2, "0");
	const ss = String(d.getSeconds()).padStart(2, "0");
	return `${hh}:${mm}:${ss}`;
}

/** A short absolute date+time label for an old run, e.g. "Jun 24, 14:30". */
function dateLabel(epochMs: number): string {
	const d = new Date(epochMs);
	const month = d.toLocaleString(undefined, { month: "short" });
	const day = d.getDate();
	const hh = String(d.getHours()).padStart(2, "0");
	const mm = String(d.getMinutes()).padStart(2, "0");
	return `${month} ${day}, ${hh}:${mm}`;
}

// ── Next-run countdown (timer of when the next heartbeat fires) ───────────────
//
// The authoritative next-run time comes from the backend
// (`GET /workspaces/:id/heartbeat/next-run` → `nextRunAt` ISO string); the FE
// computes a live countdown from it + a 1s clock. When that endpoint is absent,
// the FE falls back to an approximation (`approximateNextRunEpoch`) from the
// latest run + the configured interval.

/** Parse an ISO timestamp to epoch-ms, or null if unparseable. */
export function nextRunEpoch(iso: string | null | undefined): number | null {
	if (typeof iso !== "string" || iso.length === 0) return null;
	const t = Date.parse(iso);
	return Number.isNaN(t) ? null : t;
}

/**
 * Format a remaining-ms delta as a short countdown: "4m 32s", "32s", "1h 05m",
 * "due" (≤ 0), or "—" (unknown/null). Pure via the injected `remainingMs`.
 */
export function formatCountdown(remainingMs: number | null): string {
	if (remainingMs === null) return "—";
	if (remainingMs <= 0) return "due";
	const totalSec = Math.floor(remainingMs / 1000);
	const hours = Math.floor(totalSec / 3600);
	const mins = Math.floor((totalSec % 3600) / 60);
	const secs = totalSec % 60;
	if (hours > 0) return `${hours}h ${String(mins).padStart(2, "0")}m`;
	if (mins > 0) return `${mins}m ${String(secs).padStart(2, "0")}s`;
	return `${secs}s`;
}

/**
 * Approximate the next-run epoch-ms when the backend's `next-run` endpoint is
 * unavailable: the LATEST run's `triggeredAt` + `intervalMinutes` (only when the
 * heartbeat is enabled AND at least one run exists). Returns null otherwise (the
 * FE then shows no countdown — never a fabricated one). The latest run is the
 * max `triggeredAt` (runs need not be ordered). Pure (no `now` needed — the next
 * run is latest + interval, independent of the current time).
 */
export function approximateNextRunEpoch(
	runs: readonly HeartbeatRun[],
	intervalMinutes: number,
	enabled: boolean,
): number | null {
	if (!enabled) return null;
	let latest: number | null = null;
	for (const r of runs) {
		const t = Date.parse(r.triggeredAt);
		if (!Number.isNaN(t) && (latest === null || t > latest)) latest = t;
	}
	if (latest === null) return null;
	return latest + intervalMinutes * 60_000;
}

// ── Config form ───────────────────────────────────────────────────────────────

/**
 * The editable form state for the config panel — a mutable mirror of a loaded
 * `HeartbeatConfig` that the inputs bind to. `reasoningEffort` is resolved to
 * an effective level for the `<select>` (null ⇒ default `high`), exactly like
 * the per-conversation selector.
 *
 * The interval is split into `intervalHours` + `intervalMinutes` (0–59) for the
 * UI (two inputs), and recombined to a total-minutes value at the patch seam
 * (`patchFromForm`); the backend stores a single `intervalMinutes`.
 */
export interface HeartbeatFormState {
	enabled: boolean;
	systemPrompt: string;
	taskPrompt: string;
	intervalHours: number;
	intervalMinutes: number;
	model: string;
	reasoningEffort: ReasoningEffort;
}

/** The default interval (minutes) shown for an empty/unset config. */
export const DEFAULT_INTERVAL_MINUTES = 30;

/** Split a total-minutes value into { hours, minutes (0–59) }. Pure. */
export function splitInterval(totalMinutes: number): { hours: number; minutes: number } {
	const total = normalizeInterval(totalMinutes);
	const hours = Math.floor(total / 60);
	const minutes = total - hours * 60;
	return { hours, minutes };
}

/** Recombine hours + minutes into a clamped total-minutes value. Pure. */
export function joinInterval(hours: number, minutes: number): number {
	const h = Number.isFinite(hours) ? Math.max(0, Math.floor(hours)) : 0;
	const m = Number.isFinite(minutes) ? Math.max(0, Math.floor(minutes)) : 0;
	return normalizeInterval(h * 60 + m);
}

/**
 * Seed the editable form state from a loaded config, applying safe defaults for
 * any malformed/absent backend field so the inputs are never `undefined`.
 */
export function formFromConfig(config: HeartbeatConfig): HeartbeatFormState {
	const { hours, minutes } = splitInterval(config.intervalMinutes);
	return {
		enabled: config.enabled === true,
		systemPrompt: config.systemPrompt ?? "",
		taskPrompt: config.taskPrompt ?? "",
		intervalHours: hours,
		intervalMinutes: minutes,
		model: typeof config.model === "string" ? config.model : "",
		reasoningEffort: effectiveEffort(config.reasoningEffort ?? null),
	};
}

/** An empty form (before the config loads). */
export function emptyForm(): HeartbeatFormState {
	const { hours, minutes } = splitInterval(DEFAULT_INTERVAL_MINUTES);
	return {
		enabled: false,
		systemPrompt: "",
		taskPrompt: "",
		intervalHours: hours,
		intervalMinutes: minutes,
		model: "",
		reasoningEffort: DEFAULT_REASONING_EFFORT,
	};
}

/** Clamp a raw interval to a sane positive-minute range (1–1440 = 1 min–24 h). */
export function normalizeInterval(value: unknown): number {
	const n = typeof value === "number" && Number.isFinite(value) ? value : DEFAULT_INTERVAL_MINUTES;
	const int = Math.round(n);
	if (int < 1) return 1;
	if (int > 1440) return 1440;
	return int;
}

/**
 * The patch to PUT when persisting the form. The split hours+minutes are
 * recombined into a single `intervalMinutes` (clamped); text fields are sent
 * verbatim. `reasoningEffort` is always present (a resolved level) since the
 * heartbeat has no per-run override — it persists the level.
 */
export function patchFromForm(form: HeartbeatFormState): HeartbeatConfigPatch {
	return {
		enabled: form.enabled,
		systemPrompt: form.systemPrompt,
		taskPrompt: form.taskPrompt,
		intervalMinutes: joinInterval(form.intervalHours, form.intervalMinutes),
		model: form.model,
		reasoningEffort: form.reasoningEffort,
	};
}

/** Whether the form differs from the loaded config (drives the Save button). */
export function formDiffers(form: HeartbeatFormState, config: HeartbeatConfig): boolean {
	const { hours, minutes } = splitInterval(config.intervalMinutes);
	return (
		form.enabled !== config.enabled ||
		form.systemPrompt !== (config.systemPrompt ?? "") ||
		form.taskPrompt !== (config.taskPrompt ?? "") ||
		form.intervalHours !== hours ||
		form.intervalMinutes !== minutes ||
		form.model !== (typeof config.model === "string" ? config.model : "") ||
		form.reasoningEffort !== effectiveEffort(config.reasoningEffort ?? null)
	);
}

// ── System-prompt inheritance (heartbeat override ⇄ global default) ────────────
//
// The heartbeat's `systemPrompt` is an OVERRIDE of the global system prompt (the
// one every workspace conversation uses — there is no per-workspace system
// prompt; `GET /system-prompt` is global). An EMPTY override means "inherit the
// global default" (server-owned resolution: the backend resolves empty → global
// at run time; see CR-HB-2). These pure helpers keep the override/inherit
// semantics in ONE place so the editor + form agree.

/**
 * The prompt to DISPLAY: the heartbeat's override if it set one, else the global
 * default. The editor pre-fills the textarea with this so the user can see (and
 * tweak) what will run — but a pre-filled default is NOT an explicit edit.
 */
export function effectiveSystemPrompt(override: string, defaultPrompt: string): string {
	return override !== "" ? override : defaultPrompt;
}

/** Whether the heartbeat is inheriting the global default (empty override). */
export function isInheritingSystemPrompt(override: string): boolean {
	return override === "";
}

/**
 * The `systemPrompt` value to PERSIST for the given editable text: if the user's
 * text matches the global default (or is empty), persist `""` to INHERIT (so a
 * later change to the global default still flows through); otherwise persist the
 * text verbatim as an override. This keeps "matching the default = inheriting it"
 * — never duplicating the default into the heartbeat config.
 */
export function persistedSystemPrompt(editable: string, defaultPrompt: string): string {
	if (editable === "" || editable === defaultPrompt) return "";
	return editable;
}

// The reasoning-effort `<option>`s are reused verbatim from the per-conversation
// selector (re-exported so the config panel imports a single source).
export { effortOptions };

// ── Network-seam normalization (pure; called by the composition root) ────────
//
// The heartbeat API is untyped JSON (not a transport-contract type), so the
// store coerces each response defensively HERE (pure + tested) — a malformed/
// partial backend value can never crash the renderer. Mirrors the inline
// `Array.isArray(data.servers) ? … : []` guard the store does for LSP/MCP.

/** Narrow an untrusted string to the run-status enum, defaulting to "completed". */
function asRunStatus(value: unknown): HeartbeatRunStatus {
	if (value === "running" || value === "completed" || value === "stopped") return value;
	return "completed";
}

/** Coerce an untrusted `GET .../heartbeat/runs` body into a typed run list. */
export function normalizeHeartbeatRuns(data: unknown): readonly HeartbeatRun[] {
	if (!isRecord(data) || !Array.isArray(data.runs)) return [];
	const runs = data.runs as readonly unknown[];
	return runs
		.filter((r): r is Record<string, unknown> => r !== null && typeof r === "object")
		.map((r) => ({
			id: typeof r.id === "string" ? r.id : "",
			conversationId: typeof r.conversationId === "string" ? r.conversationId : "",
			triggeredAt: typeof r.triggeredAt === "string" ? r.triggeredAt : "",
			status: asRunStatus(r.status),
		}))
		.filter((r) => r.id !== "" && r.conversationId !== "");
}

/** Coerce an untrusted `GET`/`PUT .../heartbeat` body into a typed config. */
export function normalizeHeartbeatConfig(data: unknown): HeartbeatConfig {
	const d = isRecord(data) ? data : {};
	const effort = d.reasoningEffort;
	return {
		enabled: d.enabled === true,
		systemPrompt: typeof d.systemPrompt === "string" ? d.systemPrompt : "",
		taskPrompt: typeof d.taskPrompt === "string" ? d.taskPrompt : "",
		intervalMinutes: normalizeInterval(d.intervalMinutes),
		model: typeof d.model === "string" ? d.model : "",
		reasoningEffort:
			effort === "low" ||
			effort === "medium" ||
			effort === "high" ||
			effort === "xhigh" ||
			effort === "max"
				? effort
				: null,
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object";
}
