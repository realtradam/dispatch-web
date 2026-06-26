import type { ComputerStatusResponse, TestComputerResponse } from "@dispatch/transport-contract";
import type { Computer, ComputerEntry } from "@dispatch/wire";

/**
 * Pure core for the computer feature — zero DOM, zero effects, zero Svelte.
 *
 * A **computer** is a remote SSH target discovered from the user's `~/.ssh/config`
 * (read-only — there is no CRUD store; the user edits their config to add one).
 * The computer feature surfaces, per-conversation and per-workspace, WHICH
 * computer a turn's tools execute on (the computer analog of `cwd`). It is a
 * USER-facing control only: the computer is a tool-execution target forwarded to
 * tools and NEVER part of the model prompt (so it does not affect prompt
 * caching) — the agent never sees it.
 *
 * This module holds the pure logic: formatting a `Computer` for display, mapping a
 * live `ComputerStatusResponse.state` to a display badge, and the one-line
 * discovered-list summary. The effects (the HTTP list/get/status/test +
 * per-conversation get/set) are INJECTED via the ports below; the composition root
 * implements them.
 */

// ── Injected ports (consumer-defines-port; the composition root adapts the
//    store's HTTP calls to these shapes). Mirrors cwd-lsp's ports. ──────────────

/** Outcome of `PUT /conversations/:id/computer`; `null` when no real conversation is focused. */
export type ComputerSaveResult =
  | { readonly ok: true; readonly computerId: string | null }
  | { readonly ok: false; readonly error: string };

export type SaveComputer = (computerId: string | null) => Promise<ComputerSaveResult | null>;

/** Outcome of `GET /computers`; `null` when the list couldn't be loaded. */
export type ComputerListResult =
  | { readonly ok: true; readonly computers: readonly ComputerEntry[] }
  | { readonly ok: false; readonly error: string };

export type LoadComputers = () => Promise<ComputerListResult | null>;

/** Outcome of `GET /computers/:alias/status`; `null` when no alias / not loaded. */
export type ComputerStatusResult =
  | { readonly ok: true; readonly status: ComputerStatusResponse }
  | { readonly ok: false; readonly error: string };

export type LoadComputerStatus = (alias: string) => Promise<ComputerStatusResult | null>;

/** Outcome of `POST /computers/:alias/test`. */
export type TestComputerResult =
  | { readonly ok: true; readonly response: TestComputerResponse }
  | { readonly ok: false; readonly error: string };

export type TestComputer = (alias: string) => Promise<TestComputerResult | null>;

// ── Computer → display view ──────────────────────────────────────────────────

export type Badge = "success" | "warning" | "error" | "neutral";

export interface ComputerView {
  /** The SSH config `Host` alias — also the `computerId` users select. */
  readonly alias: string;
  /** A compact `user@host:port` connection string (the resolved config values). */
  readonly hostSummary: string;
  /** The resolved `IdentityFile`, or `null` = default `~/.ssh/id_*`. */
  readonly identityFile: string | null;
  /** Short label for the known-host indicator, e.g. "known host" / "new host". */
  readonly knownHostLabel: string;
  /** Whether the host's key is already in `~/.ssh/known_hosts`. */
  readonly knownHost: boolean;
}

/**
 * Format a computer's connection target as `user@host:port`, omitting the port
 * when it is the SSH default (22) so the summary stays compact (mirrors how a user
 * reads an ssh config `Host` block). `hostName` falls back to the alias itself
 * (the backend resolves this, but this is defensive).
 */
export function formatHost(computer: Computer): string {
  const host = computer.hostName || computer.alias;
  const port = computer.port === 22 ? "" : `:${computer.port}`;
  return `${computer.user}@${host}${port}`;
}

/** The display label for the known-host indicator. */
export function knownHostLabel(knownHost: boolean): string {
  return knownHost ? "known host" : "new host";
}

export function viewComputer(computer: Computer): ComputerView {
  return {
    alias: computer.alias,
    hostSummary: formatHost(computer),
    identityFile: computer.identityFile,
    knownHostLabel: knownHostLabel(computer.knownHost),
    knownHost: computer.knownHost,
  };
}

export function viewComputers(computers: readonly ComputerEntry[]): readonly ComputerView[] {
  return computers.map(viewComputer);
}

/**
 * A one-line summary of the discovered list, e.g. "3 computers" / "No computers
 * discovered" (the latter is the expected state until the `ssh` extension lands).
 */
export function summarizeComputers(computers: readonly ComputerEntry[]): string {
  if (computers.length === 0) return "No computers discovered";
  return `${computers.length} computer${computers.length === 1 ? "" : "s"}`;
}

// ── Connection status → display view ──────────────────────────────────────────

export interface ComputerStatusView {
  readonly alias: string;
  readonly state: ComputerStatusResponse["state"];
  readonly statusLabel: string;
  readonly badge: Badge;
  /** True while the state is transient (show a spinner). */
  readonly busy: boolean;
  /** The error reason when `state === "error"`, else null. */
  readonly error: string | null;
  /** Whether the host's key is already in `~/.ssh/known_hosts`. */
  readonly knownHost: boolean;
}

/**
 * Map a computer's live connection state to a display label + badge + busy flag.
 * Mirrors the LSP/MCP status→badge pattern (each feature owns its own mapping —
 * the enums differ, so they are not shared). Exhaustive vs the contract:
 * `connected`→success, `connecting`→warning+busy, `disconnected`→neutral (a stable
 * idle state, NOT busy), `error`→error.
 */
export function viewComputerStatus(status: ComputerStatusResponse): ComputerStatusView {
  let statusLabel: string;
  let badge: Badge;
  let busy = false;
  switch (status.state) {
    case "connected":
      statusLabel = "Connected";
      badge = "success";
      break;
    case "connecting":
      statusLabel = "Connecting…";
      badge = "warning";
      busy = true;
      break;
    case "disconnected":
      statusLabel = "Disconnected";
      badge = "neutral";
      break;
    case "error":
      statusLabel = "Error";
      badge = "error";
      break;
  }
  return {
    alias: status.alias,
    state: status.state,
    statusLabel,
    badge,
    busy,
    error: status.state === "error" ? (status.error ?? "Connection failed") : null,
    knownHost: status.knownHost,
  };
}

// ── Test-connection result → display view ───────────────────────────────────

export interface TestResultView {
  readonly alias: string;
  readonly ok: boolean;
  /** The failure reason when `ok` is false, else null. */
  readonly error: string | null;
  /** A short result label, e.g. "Connection OK" / "Failed". */
  readonly label: string;
}

export function viewTestResult(response: TestComputerResponse): TestResultView {
  return {
    alias: response.alias,
    ok: response.ok,
    error: response.ok ? null : (response.error ?? "Connection failed"),
    label: response.ok ? "Connection OK" : "Failed",
  };
}
