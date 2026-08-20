/**
 * Pure network-seam normalizers for the Named Agents API — zero DOM, zero
 * effects. The composition root coerces the UNTYPED JSON it receives from
 * `GET/POST/PUT/DELETE /named-agents` through these so a malformed / partial
 * response can never crash the renderer. Mirrors the concurrency / heartbeat
 * network-seam guard pattern.
 */

import type { NamedAgent, NamedAgentInput } from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Coerce one untrusted record into a typed `NamedAgent`, or `null` when it is
 * malformed (missing `id`, `name`, or `model` — or a non-string `model`).
 */
export function normalizeNamedAgent(value: unknown): NamedAgent | null {
  if (!isRecord(value)) return null;
  const id = asString(value.id);
  const name = asString(value.name);
  const model = asString(value.model);
  if (id === null || name === null || model === null) return null;
  return { id, name, model };
}

/**
 * Coerce an untrusted `GET /named-agents` body into a typed Named Agent list.
 * When the list key is absent/malformed, returns `[]` (defensive — the renderer
 * shows the empty state rather than crashing).
 */
export function normalizeNamedAgents(data: unknown): readonly NamedAgent[] {
  if (!isRecord(data) || !Array.isArray(data.namedAgents)) return [];
  const out: NamedAgent[] = [];
  for (const entry of data.namedAgents as readonly unknown[]) {
    const agent = normalizeNamedAgent(entry);
    if (agent !== null) out.push(agent);
  }
  return out;
}

/**
 * Coerce an untrusted `POST`/`PUT /named-agents` body (the canonical saved
 * record) into a typed `NamedAgent`, or `null` when malformed. The composition
 * root surfaces an error when this returns null on an ok response.
 */
export function normalizeNamedAgentRecord(data: unknown): NamedAgent | null {
  if (!isRecord(data)) return null;
  return normalizeNamedAgent(data.namedAgent);
}

/**
 * Coerce an untrusted `NamedAgentInput` at the create/update boundary so only
 * clean strings reach the wire. Non-string fields drop to "" (name nonempty is
 * validated separately; model nonempty too). The caller still runs name/model
 * validation so a malformed body never reaches the backend.
 */
export function toNamedAgentInput(name: unknown, model: unknown): NamedAgentInput {
  return {
    name: typeof name === "string" ? name.trim() : "",
    model: typeof model === "string" ? model : "",
  };
}
