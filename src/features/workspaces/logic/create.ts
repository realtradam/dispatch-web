/**
 * Pure create-gate logic for the New-workspace form — zero DOM, zero effects.
 *
 * `PUT /workspaces/:id` (ensure) is idempotent, so creating a slug that belongs
 * to an ARCHIVED workspace would silently "succeed": the backend returns the
 * archived workspace, the active list (which excludes archived) never shows it,
 * and the home grid would still place a tile for something invisible. The
 * frontend therefore probes `GET /workspaces/:id` first and refuses the create
 * when the slug exists and is archived.
 */

import type { Workspace } from "@dispatch/wire";

/**
 * The authoritative existence probe's outcome (`GET /workspaces/:id`). The
 * adapter maps HTTP status to these kinds; `failed` is deliberately distinct
 * from `missing` (404) so a broken check is never mistaken for "no such
 * workspace".
 */
export type WorkspaceLookup =
  | { readonly kind: "found"; readonly workspace: Workspace }
  | { readonly kind: "missing" }
  | { readonly kind: "failed"; readonly error: string };

/** Whether a create may proceed: `ok` or a user-facing error message. */
export type CreateGate = { readonly ok: true } | { readonly ok: false; readonly error: string };

/**
 * The user-facing message when a slug belongs to an archived workspace. It
 * states plainly that the create can't happen and points at the existing
 * recovery affordance (the Archived workspaces list) without adding UI.
 */
export function archivedCreateMessage(id: string): string {
  return `A workspace named "${id}" already exists and is archived — you can't create it. Unarchive it from Archived workspaces instead.`;
}

/**
 * The user-facing message when the existence probe itself failed. Proceeding
 * blindly could recreate the silent archived-tile bug, so the create is
 * refused with a retryable message instead.
 */
export function checkFailedCreateMessage(id: string, error: string): string {
  return `Couldn't check whether a workspace named "${id}" already exists (${error}). Try again.`;
}

/**
 * Decide whether a create may proceed, given the probe outcome. Pure:
 * `(id, lookup) → gate`.
 *
 * - archived slug → blocked with the "can't create" message;
 * - missing slug or an ACTIVE existing slug → proceed (`ensure` is idempotent,
 *   so an active slug keeps today's behavior);
 * - a failed probe → blocked too (plan §3.4): never guess, because proceeding
 *   could ensure an archived workspace's tile.
 */
export function gateCreate(id: string, lookup: WorkspaceLookup): CreateGate {
  if (lookup.kind === "failed") {
    return { ok: false, error: checkFailedCreateMessage(id, lookup.error) };
  }
  if (lookup.kind === "found" && lookup.workspace.archived) {
    return { ok: false, error: archivedCreateMessage(id) };
  }
  return { ok: true };
}
