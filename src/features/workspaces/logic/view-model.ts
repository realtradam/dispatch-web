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
