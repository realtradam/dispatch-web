/**
 * Pure shared types for the Named Agents feature — zero DOM, zero effects,
 * zero Svelte.
 *
 * The shared shapes — `NamedAgent`, `NamedAgentSelectionSnapshot`, and the
 * `/named-agents` HTTP request/response types — are RE-EXPORTED from the
 * backend-contract packages (`@dispatch/wire`, `@dispatch/transport-contract`),
 * which now carry them (the backend shipped the named-agents contract). The FE
 * consumes those packages as the cross-repo seam; only the FE's port/result
 * types are defined locally.
 */

import type {
  CreateNamedAgentRequest,
  DeleteNamedAgentResponse,
  NamedAgentResponse,
  NamedAgentsResponse,
  UpdateNamedAgentRequest,
} from "@dispatch/transport-contract";
import type { NamedAgent, NamedAgentSelectionSnapshot } from "@dispatch/wire";

export type {
  DeleteNamedAgentResponse,
  NamedAgent,
  NamedAgentResponse,
  NamedAgentSelectionSnapshot,
  NamedAgentsResponse,
  UpdateNamedAgentRequest,
};

/** The subset of a Named Agent a client creates/updates (plan §9 — id is server-minted). */
export type NamedAgentInput = CreateNamedAgentRequest;

// ── Ports (injected effects — the composition root supplies real responders) ──

/** Outcome of listing Named Agents. */
export type NamedAgentsResult =
  | { readonly ok: true; readonly agents: readonly NamedAgent[] }
  | { readonly ok: false; readonly error: string };

/** Outcome of creating / updating a Named Agent (the canonical saved record). */
export type NamedAgentSaveResult =
  | { readonly ok: true; readonly agent: NamedAgent }
  | { readonly ok: false; readonly error: string };

/** Outcome of removing a Named Agent. */
export type NamedAgentDeleteResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: string };

export type LoadNamedAgents = () => Promise<NamedAgentsResult>;
export type CreateNamedAgent = (input: NamedAgentInput) => Promise<NamedAgentSaveResult>;
export type UpdateNamedAgent = (
  id: string,
  input: NamedAgentInput,
) => Promise<NamedAgentSaveResult>;
export type DeleteNamedAgent = (id: string) => Promise<NamedAgentDeleteResult>;
