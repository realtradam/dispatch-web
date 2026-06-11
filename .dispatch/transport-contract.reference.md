# `@dispatch/transport-contract` — in-repo reference (read THIS, not node_modules)

> MIRRORS the backend's `@dispatch/transport-contract` package source so headless FE agents can read
> the HTTP + WebSocket wire shapes WITHOUT following the `file:` dep symlink out of this repo (which
> hangs on a permission prompt). Your CODE still imports `@dispatch/transport-contract` normally —
> this file is for READING only.
>
> **Orchestrator:** SNAPSHOT of `transport-contract@0.6.0` (the metrics endpoint shipped +
> version-bumped + LIVE-VERIFIED). Depends on `@dispatch/wire@0.5.0` (see `wire.reference.md`) +
> `@dispatch/ui-contract@0.1.0` (see `ui-contract.reference.md`).
>
> **2026-06-12 delta (context-size handoff — package bumped `0.5.0` → `0.6.0`, depends on
> `wire@0.5.0`):** no NEW transport shape — the optional `contextSize?: number` rides the
> re-exported `TurnMetrics` (so `ConversationMetricsResponse.turns[].contextSize`) and, live, the
> `TurnDoneEvent.contextSize` on the `done` AgentEvent (`chat.delta` WS / `/chat` NDJSON). On
> (re)hydrate take the LAST `turns[]` element with a defined `contextSize`; live, update on `done`.
> See the `wire.reference.md` context-size delta for the definition.
>
> **2026-06 delta (cache-warming handoff, additive — package still `0.4.0`):** adds
> `POST /chat/warm` (`WarmRequest` → `WarmResponse`) for an on-demand prompt-cache warm, and the
> throughput axis `GET /metrics/throughput` (`ThroughputResponse`/`ThroughputModelStat`/
> `ThroughputPeriod`). The warm is NEVER persisted/streamed and NEVER folded into a conversation's
> real usage. Pairs with the `cache-warming` conversation-scoped surface + `NumberField` in
> `ui-contract.reference.md`.
>
> **2026-06-11 delta (cache-rate fix handoff, additive — package still `0.4.0`):** `WarmResponse`
> gains `expectedCacheRate` (the warming HEALTH/retention signal,
> `round(cacheReadTokens / (cacheReadTokens + cacheWriteTokens) * 100)`). Consumed FE-side: headlined
> on the "Warm now" result. (No `ui-contract` change — the `cache-warming` surface's new
> `cache-warming-timer` payload + second "cache retention" `stat` ride the EXISTING `custom`/`stat`
> kinds; the FE cache-warming feature parses them.)
>
> **2026-06-11 delta (LSP + cwd handoff — package bumped to `0.5.0`):** adds per-conversation working
> directory `GET /conversations/:id/cwd` + `PUT /conversations/:id/cwd` (`CwdResponse`/`SetCwdRequest`,
> CORS now allows `PUT`) and per-conversation LSP status `GET /conversations/:id/lsp`
> (`LspStatusResponse`/`LspServerInfo`/`LspServerState`). The LSP GET LAZILY spawns+initializes the
> configured servers (can take a moment the first time per cwd; cached after) and returns once each
> server settles to `connected`/`error`. `servers` is `[]` when `cwd` is null. A `/chat`(`/warm`)
> request that omits `cwd` now defaults to the conversation's persisted cwd; one that sends `cwd`
> persists it. Consumed FE-side by the `workspace` feature (cwd field in the Model view + a
> "Language Servers" view).
>
> **0.3.0 change (token + timing metrics):** adds the durable metrics READ endpoint
> `GET /conversations/:id/metrics` → `ConversationMetricsResponse` (`{ turns: TurnMetrics[] }`), and
> re-exports `StepMetrics` / `TurnMetrics` from `@dispatch/wire`. This is a SEPARATE read axis from
> the seq-cursor history (`GET /conversations/:id`): metrics are keyed PER TURN (not per chunk), so
> they get their own route. `turns` is every SEALED turn's `TurnMetrics` in turn order (an in-flight
> turn is absent until its metrics persist post-seal). The live `usage`/`step-complete`/`done`
> packets it mirrors are transient (NOT persisted) and ride the `chat.delta`/NDJSON `AgentEvent`
> stream you already consume — see `wire.reference.md`. The contract's OWN chat/history shapes are
> otherwise unchanged from 0.2.0.

## Endpoints (backend — CORS wildcard `*`, HTTP port 24203, WS port 24205)

- `POST /chat` — body `ChatRequest` (JSON); response NDJSON stream, one `AgentEvent` per line;
  resolved id also in `X-Conversation-Id` header.
- `GET /models` — `ModelsResponse`.
- `GET /conversations/:id?sinceSeq=<n>` — `ConversationHistoryResponse`: RAW, append-order,
  seq-ordered slice with `seq > n` (NOT reconciled — dangling tool-calls returned as-is).
  `latestSeq` = last chunk's `seq`, or the requested `sinceSeq` when caught up (empty `chunks`).
- `GET /conversations/:id/metrics` — `ConversationMetricsResponse`: every SEALED turn's `TurnMetrics`
  in turn order (per-turn token + timing; NOT seq-filtered). IMPLEMENTED + LIVE-VERIFIED (probe 17/17).
- `POST /chat/warm` — body `WarmRequest` (JSON) → `200 WarmResponse` (cache-warm usage incl.
  `cachePct`); `409 { error }` when the conversation is currently generating; `400 { error }` on a
  missing/invalid `conversationId`. The warm is NEVER persisted/streamed/folded into real usage.
- `GET /metrics/throughput?period=day|week|month&date=<...>` — `ThroughputResponse` (token-weighted
  tokens/sec per model over the window). Not part of cache-warming; listed for completeness.
- `GET /conversations/:id/cwd` — `CwdResponse` (`cwd` is `null` until set).
- `PUT /conversations/:id/cwd` — body `SetCwdRequest` → `200 CwdResponse`; `400 { error }` if `cwd`
  missing/empty. CORS allows `PUT`.
- `GET /conversations/:id/lsp` — `LspStatusResponse`. LAZILY spawns+initializes the configured servers
  on the first call per cwd (can take a moment; cached after); returns once each settles to
  `connected`/`error`. `servers` is `[]` when `cwd` is null.
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
import type { AgentEvent, StoredChunk, TurnMetrics } from "@dispatch/wire";

export type { AgentEvent, StepMetrics, StoredChunk, TurnMetrics } from "@dispatch/wire";

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

/**
 * Response body for `GET /conversations/:id/metrics` — the persisted per-turn
 * (and per-step) token + timing metrics for a conversation, for a client
 * reopening a past conversation to render historical usage/latency.
 *
 * This is a SEPARATE axis from the two other read concerns and is deliberately
 * its own endpoint: the live `usage`/`step-complete`/`done` events are transient
 * (not persisted), and `ConversationHistoryResponse` carries seq-cursor chunk
 * CONTENT. Metrics are keyed per TURN (not per chunk) and so are not seq-filtered
 * — hence a sibling route rather than a field on the history response.
 *
 * `turns` is every SEALED turn's `TurnMetrics` in turn order. A turn appears only
 * after its metrics were persisted (post-seal); an in-flight or unsealed turn is
 * absent until then.
 */
export interface ConversationMetricsResponse {
	readonly turns: readonly TurnMetrics[];
}

/** The aggregation window for `GET /metrics/throughput`. */
export type ThroughputPeriod = "day" | "week" | "month";

/** One model's token-weighted throughput over a period. */
export interface ThroughputModelStat {
	readonly model: string;
	readonly tokensPerSecond: number;
	readonly totalOutputTokens: number;
	readonly totalGenMs: number;
	readonly turns: number;
}

/** Response body for `GET /metrics/throughput?period=...&date=...`. */
export interface ThroughputResponse {
	readonly period: ThroughputPeriod;
	readonly date: string;
	readonly start: number; // inclusive window start, epoch-ms
	readonly end: number; // exclusive window end, epoch-ms
	readonly models: readonly ThroughputModelStat[];
}

/**
 * Request body for `POST /chat/warm` — manually trigger a prompt-cache WARMING
 * request for a conversation (e.g. a "warm now" button). The warm replays the
 * conversation's existing prefix to refresh the provider cache; it is NEVER
 * persisted and NEVER streamed. Pass the SAME `model`/`cwd` the conversation
 * chats with so the prefix is byte-identical to a real turn (that's the cache hit).
 */
export interface WarmRequest {
	readonly conversationId: string;
	readonly model?: string; // `<credentialName>/<model>`; omit = server default
	readonly cwd?: string;
}

/**
 * Response body for `POST /chat/warm` (HTTP 200). The warm's usage — never folded
 * into the conversation's real usage. A client surfaces `cachePct` as the "last
 * warming" cache-hit indicator. A 409 (currently generating) returns `{ error }` instead.
 */
export interface WarmResponse {
	readonly inputTokens: number;
	readonly outputTokens: number;
	readonly cacheReadTokens: number;
	readonly cacheWriteTokens: number;
	/**
	 * **Cache rate** — what fraction of THIS request's prompt was served from cache:
	 * `round(cacheReadTokens / inputTokens * 100)` (0 when `inputTokens <= 0`).
	 * (`inputTokens` is the TOTAL prompt incl. cached, so this is in [0,100].)
	 */
	readonly cachePct: number;
	/**
	 * **Expected cache (retention)** — of the cacheable prefix this warm touched, how
	 * much was still warm and read back vs. had to be (re)written:
	 * `round(cacheReadTokens / (cacheReadTokens + cacheWriteTokens) * 100)` (0 when the
	 * sum is 0). For a healthy warm this is ~**100%**; it drops toward 0 as the cache
	 * expires/busts. This is the warming HEALTH signal — headline it for "Warm now".
	 */
	readonly expectedCacheRate: number;
}

// ─── Per-conversation working directory (cwd) ─────────────────────────────────

/** Response of `GET /conversations/:id/cwd`. `cwd` is null when never set. */
export interface CwdResponse {
	readonly conversationId: string;
	readonly cwd: string | null;
}

/** Body of `PUT /conversations/:id/cwd`. */
export interface SetCwdRequest {
	readonly cwd: string;
}

// ─── Per-conversation LSP status ──────────────────────────────────────────────

/** The connection state of a single language server for a workspace. */
export type LspServerState = "connected" | "starting" | "error" | "not-started";

/** One language server's status as reported to the frontend. */
export interface LspServerInfo {
	/** Stable server id, e.g. "typescript", "luau-lsp". */
	readonly id: string;
	/** Human-readable display name. */
	readonly name: string;
	/** The resolved workspace root the server is (or would be) rooted at (absolute). */
	readonly root: string;
	/** File extensions this server handles, e.g. [".ts", ".tsx"] or [".luau"]. */
	readonly extensions: readonly string[];
	/** Current connection state. */
	readonly state: LspServerState;
	/** Present only when `state === "error"`: a short human-readable reason. */
	readonly error?: string;
}

/** Response of `GET /conversations/:id/lsp`. */
export interface LspStatusResponse {
	readonly conversationId: string;
	/** The conversation's persisted cwd, or null if unset (then `servers` is empty). */
	readonly cwd: string | null;
	/** The language servers configured for `cwd` and their live state. */
	readonly servers: readonly LspServerInfo[];
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
