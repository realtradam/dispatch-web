# `@dispatch/transport-contract` — in-repo reference (read THIS, not node_modules)

> MIRRORS the backend's `@dispatch/transport-contract` package source so headless FE agents can read
> the HTTP + WebSocket wire shapes WITHOUT following the `file:` dep symlink out of this repo (which
> hangs on a permission prompt). Your CODE still imports `@dispatch/transport-contract` normally —
> this file is for READING only.
>
> **Orchestrator:** SNAPSHOT of `transport-contract@0.3.0`. Regenerate whenever it changes.
> Depends on `@dispatch/wire@0.3.0` (see `wire.reference.md`) + `@dispatch/ui-contract`
> (see `ui-contract.reference.md`).
>
> **0.3.0 change (live metrics):** no shape change HERE — this contract's own types are identical.
> It re-exports the bumped `@dispatch/wire`, whose `AgentEvent` union gained a `step-complete`
> variant and timing fields on `usage`/`tool-result`/`done`. So the `chat.delta` events you stream
> over WS now also carry the live metrics. See `frontend-metrics-handoff.md` for the full guide.
> (0.2.0: tool-call `stepId` grouping.)

## Endpoints (backend, confirmed live — CORS wildcard `*`, HTTP port 24203, WS port 24205)

- `POST /chat` — body `ChatRequest` (JSON); response NDJSON stream, one `AgentEvent` per line;
  resolved id also in `X-Conversation-Id` header.
- `GET /models` — `ModelsResponse`.
- `GET /conversations/:id?sinceSeq=<n>` — `ConversationHistoryResponse`: RAW, append-order,
  seq-ordered slice with `seq > n` (NOT reconciled — dangling tool-calls returned as-is).
  `latestSeq` = last chunk's `seq`, or the requested `sinceSeq` when caught up (empty `chunks`).
- WebSocket on :24205 — ONE path-agnostic socket multiplexes surface ops
  (`@dispatch/ui-contract`) + chat ops (below). Open once, send `WsClientMessage`, receive
  `WsServerMessage`. Live `AgentEvent` deltas carry `conversationId`+`turnId` but **no `seq`**
  (seq lives only on `StoredChunk`, obtained via the `sinceSeq` sync after `turn-sealed`).
- DEFERRED (not built; do not depend on): `GET /conversations` (list), `POST /conversations/:id/cancel`.

```ts
/**
 * Transport contract — the typed description of Dispatch's client–server API
 * (HTTP + WebSocket). Types-only (zero runtime). Each side owns its own
 * (de)serialization — the contract is the SHAPES, not the codec.
 *
 * The WebSocket carries BOTH chat ops (here) and surface ops (in
 * `@dispatch/ui-contract`) over one connection; the unified `WsClientMessage` /
 * `WsServerMessage` unions below compose them. Chat ops are new, non-colliding
 * `type` variants (`chat.*`) — the shipped surface protocol is unchanged.
 */

import type { SurfaceClientMessage, SurfaceServerMessage } from "@dispatch/ui-contract";
import type { AgentEvent, StoredChunk } from "@dispatch/wire";

export type { AgentEvent, StoredChunk } from "@dispatch/wire";

/**
 * Request body for `POST /chat` (sent as JSON).
 *
 * The response is an NDJSON stream: one JSON-encoded `AgentEvent` per line.
 * The resolved conversation id is also returned in the `X-Conversation-Id`
 * response header (useful when `conversationId` was omitted).
 */
export interface ChatRequest {
	/** The conversation to continue. Omit to start fresh — server mints an id (X-Conversation-Id). */
	readonly conversationId?: string;
	/** The user's message text for this turn. */
	readonly message: string;
	/** Model name in `<credentialName>/<model>` form (one of `GET /models`). Omit = server default. */
	readonly model?: string;
	/** Working directory for this turn's tool execution. Defaults server-side. Not part of the prompt. */
	readonly cwd?: string;
}

/**
 * Response body for `GET /models` — the model catalog. Each entry is a model
 * name in `<credentialName>/<model>` form (exactly `ChatRequest.model`).
 */
export interface ModelsResponse {
	readonly models: readonly string[];
}

/**
 * Response body for `GET /conversations/:id?sinceSeq=<n>` — the incremental
 * read-side history endpoint a long-lived client uses to (re)hydrate cheaply.
 *
 * `chunks` is the RAW, append-order, seq-ordered slice with `seq > sinceSeq`
 * (or the whole log when `sinceSeq` is omitted/0). NOT reconciled: a dangling
 * tool-call is returned as-is. `latestSeq` is the `seq` of the LAST chunk, or —
 * when the slice is empty (caught up) — the requested `sinceSeq` (0 for a full
 * read of an empty conversation). After applying, the client's new cursor is
 * always `latestSeq`; empty `chunks` means "nothing new past your cursor".
 */
export interface ConversationHistoryResponse {
	readonly chunks: readonly StoredChunk[];
	readonly latestSeq: number;
}

// ─── WebSocket chat ops ───────────────────────────────────────────────────────
// The persistent WS connection multiplexes chat ops (below) with surface ops
// (`@dispatch/ui-contract`). Chat `type`s are namespaced (`chat.*`) so they
// never collide with surface ones.

/**
 * Client → server: start or continue a turn over the WS connection. Same fields
 * as the HTTP `ChatRequest`; omit `conversationId` to start fresh — the resolved
 * id arrives on the streamed `AgentEvent`s (each carries `conversationId`).
 */
export interface ChatSendMessage extends ChatRequest {
	readonly type: "chat.send";
}

/**
 * Server → client: one `AgentEvent` from an in-flight turn (text-delta,
 * tool-call, usage, done, turn-sealed, …). Fold these into the transcript
 * exactly as the HTTP NDJSON stream — same events, different carrier.
 */
export interface ChatDeltaMessage {
	readonly type: "chat.delta";
	readonly event: AgentEvent;
}

/**
 * Server → client: a chat-scoped TRANSPORT error — e.g. a malformed `chat.send`
 * or a failure before a turn could start. (Errors DURING a turn arrive as a
 * `TurnErrorEvent` inside a `chat.delta`.)
 */
export interface ChatErrorMessage {
	readonly type: "chat.error";
	readonly conversationId?: string;
	readonly message: string;
}

/** Every client → server WS message: surface ops + chat ops. Discriminate on `type`. */
export type WsClientMessage = SurfaceClientMessage | ChatSendMessage;

/** Every server → client WS message: surface ops + chat ops. Discriminate on `type`. */
export type WsServerMessage = SurfaceServerMessage | ChatDeltaMessage | ChatErrorMessage;
```
