/**
 * Pure view-model helpers for the workspaces feature — zero DOM, zero effects.
 */

import type { WorkspaceEntry } from "@dispatch/wire";
import type { Route } from "./route";

/**
 * The browser tab / page (`document.title`) text for a route. The home route
 * (`/`) is "Dispatch"; a workspace route (`/<id>`) is "Dispatch: {title}",
 * using the workspace's display title and falling back to the URL slug (`id`)
 * until the workspace list has loaded it — the backend defaults a workspace's
 * title to its id, so the slug is the correct transient value. Pure: route +
 * workspaces in, string out.
 */
export function pageTitle(route: Route, workspaces: readonly WorkspaceEntry[]): string {
  if (route.kind === "home") return "Dispatch";
  const ws = workspaces.find((w) => w.id === route.id);
  return `Dispatch: ${ws?.title ?? route.id}`;
}

/**
 * Sort workspaces for display: starred first, then most-recently-active. Pure:
 * the list in, a NEW sorted array out (the input is not mutated). Starred
 * workspaces jump to the top (the FE-side echo of their concurrency-priority);
 * within each group (starred / not) `lastActivityAt` desc breaks ties, matching
 * the backend's list ordering. Stable for equal `lastActivityAt`.
 */
export function sortWorkspaces<T extends WorkspaceEntry>(workspaces: readonly T[]): T[] {
  return [...workspaces].sort((a, b) => {
    if (a.starred !== b.starred) return a.starred ? -1 : 1;
    return b.lastActivityAt - a.lastActivityAt;
  });
}

/**
 * Return a NEW list with the one workspace's `starred` flag set (immutably —
 * the entry is replaced, the rest keep their identity). Pure: the optimistic
 * star/unstar transformation shared by the apply + the error revert. A missing
 * `id` (not yet in the list — e.g. starring a workspace the home view hasn't
 * loaded) leaves the list unchanged; the backend's create-on-miss still applies
 * server-side and a subsequent refresh reconciles.
 */
export function applyStarred<T extends WorkspaceEntry>(
  workspaces: readonly T[],
  id: string,
  starred: boolean,
): T[] {
  return workspaces.map((w) => (w.id === id ? { ...w, starred } : w));
}

/**
 * Format an epoch-ms timestamp as a short relative string ("now", "3m", "2h",
 * "5d", or a date). Pure: `now` + `then` in, string out. Future timestamps
 * (a workspace just created) read as "now".
 */
export function relativeTime(then: number, now: number): string {
  const diff = now - then;
  if (diff < 60_000) return "now";
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  // Beyond a week: a short date (MM/DD). Uses UTC parts for determinism in tests.
  const d = new Date(then);
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${month}/${day}`;
}
