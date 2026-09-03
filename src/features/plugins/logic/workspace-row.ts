import type { WorkspacePluginRow, WorkspacePluginStateValue } from "@dispatch/transport-contract";

/**
 * Pure helpers for the per-workspace plugin modal (plan 06 §6.6 wire rows →
 * checkbox semantics). Zero DOM.
 *
 * State model (backend-canonical): `"enabled"` / `"disabled"` — an explicit
 * record — or `"undefined"` for NO record (the blank slate; behaves disabled
 * for Providers/Standard). Core rows arrive materialized `enabled` (Q-A).
 */

/** Whether the modal checkbox is checked for a row (explicit `enabled` only). */
export function rowChecked(row: WorkspacePluginRow): boolean {
  return row.state === "enabled";
}

/**
 * Whether the row's checkbox is selectable. Two unselectable cases (§7
 * strict layering + plan 06 §6.6):
 * - the plugin is NOT loaded globally → greyed out and unselectable (only the
 *   global manager loads code);
 * - the server reports the row locked (tier "core") → the server refuses the
 *   PUT (`core-locked` 409), so the control is disabled with a tooltip.
 */
export function rowSelectable(row: WorkspacePluginRow): boolean {
  return row.loaded && !row.locked;
}

/**
 * Why the row is unselectable (tooltip text), or null when interactive.
 * Unloaded beats locked in the copy (the user's actionable next step is the
 * global manager).
 */
export function rowBlockReason(row: WorkspacePluginRow): string | null {
  if (!row.loaded) {
    return "Not loaded globally — load it in the plugin manager first (only the manager loads code).";
  }
  if (row.locked) {
    return "Core plugins are enabled by default in every workspace and managed globally.";
  }
  return null;
}

/** The effective-state label shown next to a row (uniform three-state grammar). */
export function stateLabel(state: WorkspacePluginStateValue): string {
  switch (state) {
    case "enabled":
      return "enabled";
    case "disabled":
      return "disabled";
    case "undefined":
      return "not set";
  }
}
