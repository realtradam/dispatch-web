/**
 * Pure snapshot helpers for Named Agent selection (plan §7).
 *
 * Selecting a Named Agent for a conversation resolves it to its raw model AND
 * records a `NamedAgentSelectionSnapshot` ({namedAgentId, namedAgentName, model})
 * so the conversation retains how it was selected. Later edits to the shared
 * Named Agent (rename / model change / removal) therefore do NOT retroactively
 * change an existing conversation — the snapshot is what the UI keeps showing.
 */

import type { NamedAgent, NamedAgentSelectionSnapshot } from "./types";

/** Build the snapshot a conversation would retain for a Named Agent selection. */
export function snapshotFor(agent: NamedAgent): NamedAgentSelectionSnapshot {
  return {
    namedAgentId: agent.id,
    namedAgentName: agent.name,
    model: agent.model,
  };
}

/**
 * Find a Named Agent by stable id or (case-insensitively) by name. Used to
 * resolve a name/id picked in the model selector back to its current definition.
 * Returns undefined when unknown (a stale name/id after deletion).
 */
export function findNamedAgent(
  agents: readonly NamedAgent[],
  idOrName: string,
): NamedAgent | undefined {
  const lower = idOrName.trim().toLowerCase();
  return agents.find((a) => a.id === idOrName || a.name.trim().toLowerCase() === lower);
}
