# `@dispatch/transport-contract` — in-repo reference (read THIS, not node_modules)

> MIRRORS the backend's `@dispatch/transport-contract` package source so headless FE agents can read
> the HTTP + WebSocket wire shapes WITHOUT following the `file:` dep symlink out of this repo (which
> hangs on a permission prompt). Your CODE still imports `@dispatch/transport-contract` normally —
> this file is for READING only.
>
> **Orchestrator:** SNAPSHOT of `transport-contract@0.11.0` (reasoning effort shipped).
> Depends on `@dispatch/wire@0.7.0` (see `wire.reference.md`) + `@dispatch/ui-contract@0.2.0` (see
> `ui-contract.reference.md`).
>
> **2026-06-12 delta (reasoning-effort handoff — package bumped `0.10.0` → `0.11.0`, ADDITIVE):**
> the thinking-depth knob (`ReasoningEffort`, re-exported from `wire@0.7.0`) lands in TWO scopes,
> resolved server-side per turn (per-turn override → persisted conversation value → default
> `"high"`; do NOT re-implement the chain client-side):
> 1. **Per-turn override** — optional `reasoningEffort?: ReasoningEffort` on `ChatRequest` (and
>    therefore on WS `chat.send`, which extends it). Applies to THAT turn only; never persists.
>    OMIT the key for "no override" (never send `null`/`""`).
> 2. **Persisted per-conversation setting** — `GET /conversations/:id/reasoning-effort` →
>    `ReasoningEffortResponse { conversationId, reasoningEffort: ReasoningEffort | null }`
>    (`null` = never set ⇒ the default `"high"` applies, NOT "off") and
>    `PUT /conversations/:id/reasoning-effort` body `SetReasoningEffortRequest
>    { reasoningEffort }`. Takes effect from the NEXT turn.
> Validation: an unrecognized level → HTTP 400 `{ error }` listing the valid levels (same for the
> WS path via the standard `chat.send` error reply). Cache note: CHANGING the level changes the
> provider request shape and can bust the prompt cache for the next turn (one-time re-prefill);
> a stable setting stays cache-safe (warming uses the same resolved effort).
>
> **2026-06-12 delta (CR-5 history windowing — package bumped `0.9.0` → `0.10.0`):** NO type-shape
> change — `GET /conversations/:id` gains two OPTIONAL query params alongside `sinceSeq`:
> **`limit=<k>`** (the NEWEST `k` chunks of the selection, still ASCENDING; a selection with ≤ `k`
> chunks is returned whole; omitted = full selection, byte-identical to the old behavior) and
> **`beforeSeq=<s>`** (exclusive upper bound `seq < s`; combined: `sinceSeq < seq < beforeSeq`).
> `limit`/`beforeSeq` must be POSITIVE integers (`sinceSeq` may still be 0); malformed/zero/negative
> → HTTP 400 `{ error }` naming the param. Seq numbering is now a WRITTEN CONTRACT: 1-based,
> monotonic, gap-free (see `wire@0.6.1` `StoredChunk`), so `hasOlder = oldestLoaded.seq > 1` — there
> is deliberately NO `earliestSeq`/`hasOlder` field. CAVEAT: on a windowed read, `latestSeq`
> describes the returned WINDOW; never regress a tail cursor from a `beforeSeq` backfill page.
> Intended flows: fresh load `?sinceSeq=0&limit=<k>` · tail sync `?sinceSeq=<cursor>` (no limit) ·
> page older in `?beforeSeq=<oldestLoadedSeq>&limit=<k>`.
>
> **2026-06-12 delta (CR-4 cache-warming lifecycle — package bumped `0.8.0` → `0.9.0`):** adds
> `POST /conversations/:id/close` (`CloseConversationResponse`) — the EXPLICIT "user closed this
> conversation's tab" affordance, distinct from a socket disconnect / `chat.unsubscribe` (which
> still NEVER touch the turn or the warming schedule). Closing (1) aborts any in-flight turn — the
> kernel stops at the next event boundary, partial messages are PERSISTED, and the turn SEALS
> normally with `finishReason: "aborted"` (watchers receive `done` then `turn-sealed`, so a
> stream-derived "generating" flag clears with no special-casing) — and (2) stops + DISABLES
> cache-warming for the conversation (persisted OFF; reopening does not resume warming). Idempotent:
> closing an idle/unknown conversation is `200` with `abortedTurn: false`. Backend behavior fixes
> riding EXISTING shapes (no other contract change): warming now defaults OFF for a new conversation
> (240s interval default kept; re-enable restores the persisted interval); post-warm surface updates
> now carry the FUTURE `nextWarmAt` (notify-before-reschedule fixed); `nextWarmAt: null` is pushed on
> `turn-start` (nothing scheduled while generating) and when warming is/became disabled. Caveat: the
> warming opt-in is NOT yet re-hydrated across a backend restart (reads disabled until toggled again).
>
> **2026-06-12 delta (CR-3 user-message handoff — package bumped `0.7.0` → `0.8.0`):** NO transport
> shape change — it re-exports `AgentEvent` (which `chat.delta` / `/chat` NDJSON carry), and that union
> gained the additive `TurnInputEvent` (`{ type: "user-message"; conversationId; turnId; text }`), the
> turn's user prompt, emitted as the FIRST event of every turn (before `turn-start`) and replayed to
> watchers/late-joiners. See the `wire.reference.md` CR-3 delta + `TurnInputEvent` for the definition.
>
> **2026-06-12 delta (turn-continuity handoff — package bumped `0.6.0` → `0.7.0`, ADDITIVE):** a turn
> is no longer bound to the WS connection — it runs to completion server-side regardless of any
> client, and any number of connections can watch the same conversation (incl. a late-joiner that
> connects mid-turn). Two new client→server WS messages: `ChatSubscribeMessage`
> (`{ type: "chat.subscribe"; conversationId }`) and `ChatUnsubscribeMessage`
> (`{ type: "chat.unsubscribe"; conversationId }`); `WsClientMessage` now unions both. Server→client
> is UNCHANGED (turn events still arrive as `chat.delta`, replayed AND live). Semantics: `chat.subscribe`
> registers the connection + immediately REPLAYS the in-flight turn's events so far (from its
> `turn-start`) then streams live (nothing replayed if idle); `chat.send` AUTO-subscribes the sending
> connection (a 2nd send while generating ⇒ `chat.error` + you stay subscribed to watch the running
> turn); `chat.unsubscribe`/socket-close drops the subscription but NEVER stops the turn; subscriptions
> persist across turns. FE consumes via the `chat` feature + app store (re-subscribe every open
> conversation on (re)connect + page load; derive a "running" state structurally from
> `turn-start`…no-`done`/`turn-sealed`-yet). OUT of scope: per-step crash-resume, concurrent-send
> arbitration.
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
- `GET /conversations/:id?sinceSeq=<n>&beforeSeq=<s>&limit=<k>` — `ConversationHistoryResponse`:
  RAW, append-order, seq-ordered slice with `n < seq < s`, windowed to the NEWEST `k` (all params
  optional; NOT reconciled — dangling tool-calls returned as-is). `latestSeq` = last chunk's `seq`,
  or the requested `sinceSeq` when caught up (empty `chunks`) — a TAIL cursor only; do not regress
  a cursor from a windowed/backfill read. `limit`/`beforeSeq` must be positive ints → else 400.
- `GET /conversations/:id/metrics` — `ConversationMetricsResponse`: every SEALED turn's `TurnMetrics`
  in turn order (per-turn token + timing; NOT seq-filtered). IMPLEMENTED + LIVE-VERIFIED (probe 17/17).
- `POST /chat/warm` — body `WarmRequest` (JSON) → `200 WarmResponse` (cache-warm usage incl.
  `cachePct`); `409 { error }` when the conversation is currently generating; `400 { error }` on a
  missing/invalid `conversationId`. The warm is NEVER persisted/streamed/folded into real usage.
- `POST /conversations/:id/close` — no body → `200 CloseConversationResponse`. The EXPLICIT tab-close
  affordance: aborts any in-flight turn (persists the partial; seals with `finishReason: "aborted"`)
  AND stops + disables cache-warming (persisted OFF). Idempotent (`abortedTurn: false` when idle/unknown).
- `GET /metrics/throughput?period=day|week|month&date=<...>` — `ThroughputResponse` (token-weighted
  tokens/sec per model over the window). Not part of cache-warming; listed for completeness.
- `GET /conversations/:id/cwd` — `CwdResponse` (`cwd` is `null` until set).
- `PUT /conversations/:id/cwd` — body `SetCwdRequest` → `200 CwdResponse`; `400 { error }` if `cwd`
  missing/empty. CORS allows `PUT`.
- `GET /conversations/:id/lsp` — `LspStatusResponse`. LAZILY spawns+initializes the configured servers
  on the first call per cwd (can take a moment; cached after); returns once each settles to
  `connected`/`error`. `servers` is `[]` when `cwd` is null.
- `GET /conversations/:id/reasoning-effort` — `ReasoningEffortResponse` (`reasoningEffort` is `null`
  when never set ⇒ default `"high"` applies). Works for an unseen/draft id.
- `PUT /conversations/:id/reasoning-effort` — body `SetReasoningEffortRequest` →
  `200 ReasoningEffortResponse`; `400 { error }` on an unrecognized level (the message lists the
  valid levels). Persists the conversation's sticky level; effective from the NEXT turn.
- WebSocket on :24205 — ONE path-agnostic socket multiplexes surface ops
  (`@dispatch/ui-contract`) + chat ops (below). Open once, send `WsClientMessage`, receive
  `WsServerMessage`. Live `AgentEvent` deltas carry `conversationId`+`turnId` but **no `seq`**
  (seq lives only on `StoredChunk`, obtained via the `sinceSeq` sync after `turn-sealed`).
- DEFERRED (not built; do not depend on): `GET /conversations` (list). (The former deferred
  `POST /conversations/:id/cancel` is superseded by `POST /conversations/:id/close`.)

```ts
/**
 * Transport contract — the typed description of Dispatch's client–server API
 * (HTTP + WebSocket).
 *
 * This package is types-only (zero runtime). It is the single shared surface
 * every client imports to know how to talk to the backend. Each side owns its
 * OWN (de)serialization: the contract is the SHAPES, not the codec. The
 * streaming response payload is the kernel's `AgentEvent` union, re-exported
 * here so a client has one import for the whole wire.
 *
 * The WebSocket carries BOTH chat ops (defined here) and surface ops (defined in
 * `@dispatch/ui-contract`) over one connection; the unified `WsClientMessage` /
 * `WsServerMessage` unions below compose them.
 */

import type { SurfaceClientMessage, SurfaceServerMessage } from "@dispatch/ui-contract";
import type { AgentEvent, ReasoningEffort, StoredChunk, TurnMetrics } from "@dispatch/wire";

export type {
	AgentEvent,
	ReasoningEffort,
	StepMetrics,
	StoredChunk,
	TurnMetrics,
} from "@dispatch/wire";

/**
 * Request body for `POST /chat` (sent as JSON).
 *
 * The response is an NDJSON stream: one JSON-encoded `AgentEvent` per line.
 * The resolved conversation id is also returned in the `X-Conversation-Id`
 * response header (useful when `conversationId` was omitted).
 */
export interface ChatRequest {
	/**
	 * The conversation to continue. Omit to start a fresh conversation — the
	 * server mints an id and returns it via the `X-Conversation-Id` header.
	 */
	readonly conversationId?: string;

	/** The user's message text for this turn. */
	readonly message: string;

	/**
	 * The model to use, as a model name in `<credentialName>/<model>` form — one
	 * of the exact strings returned by `GET /models`. Omit to use the server's
	 * default credential + model.
	 */
	readonly model?: string;

	/**
	 * Working directory for this turn's tool execution. Defaults server-side when
	 * omitted. Forwarded to tools for path resolution; never part of the model
	 * prompt (so it does not affect prompt caching).
	 */
	readonly cwd?: string;

	/**
	 * Reasoning-effort override for THIS turn only (does not persist). When
	 * omitted, the server resolves the conversation's persisted value, falling
	 * back to `"high"`. Must be one of the `ReasoningEffort` levels; an
	 * unrecognized value → HTTP 400 `{ error }`.
	 */
	readonly reasoningEffort?: ReasoningEffort;
}

/**
 * Response body for `GET /models` — the model catalog.
 *
 * Each entry is a model name in `<credentialName>/<model>` form: exactly the
 * string a client passes back as `ChatRequest.model`.
 */
export interface ModelsResponse {
	readonly models: readonly string[];
}

/**
 * Response body for
 * `GET /conversations/:id?sinceSeq=<n>&beforeSeq=<s>&limit=<k>` — the
 * incremental read-side history endpoint a long-lived client uses to
 * (re)hydrate a conversation cheaply. All three query params are OPTIONAL and
 * combine as one SELECTION + one WINDOW:
 *
 * - **Selection** — `sinceSeq` (exclusive lower bound, `seq > n`; omitted/0 =
 *   from the start) and `beforeSeq` (exclusive upper bound, `seq < s`; omitted
 *   = to the end). Together: `n < seq < s`.
 * - **Window** — `limit=<k>` returns only the NEWEST `k` chunks of the
 *   selection (the response stays ASCENDING by seq). A selection with ≤ `k`
 *   chunks is returned whole. `limit` omitted = the full selection — exactly
 *   the pre-windowing behavior, so existing clients are unchanged.
 * - `limit` and `beforeSeq` must be POSITIVE integers (`sinceSeq` may be 0);
 *   malformed, zero, or negative values → HTTP 400 `{ error }`.
 *
 * Intended client flows: fresh load = `?sinceSeq=0&limit=<k>` (newest window);
 * tail sync = `?sinceSeq=<cursor>` (no limit); page older history in =
 * `?beforeSeq=<oldestLoadedSeq>&limit=<k>`.
 *
 * Seq numbering is **1-based and gap-free** (a CONTRACTUAL GUARANTEE — see
 * `StoredChunk` in `@dispatch/wire`): a client can derive "older chunks exist"
 * purely from `oldestLoaded.seq > 1`; there is deliberately no
 * `earliestSeq`/`hasOlder` response field.
 *
 * `chunks` is the RAW, append-order, seq-ordered slice of the conversation log
 * selected + windowed as above. It is NOT reconciled: a dangling tool-call is
 * returned as-is (rendered as an interrupted call). Reconciliation is a
 * turn-path concern — the server repairs history only when it feeds a provider,
 * never on this read path — which is what preserves the per-chunk `seq` cursor
 * invariant (a synthesized repair chunk would have no seq).
 *
 * `latestSeq` is the `seq` of the LAST chunk in this response, or — when the
 * slice is empty (the client is already caught up) — the requested `sinceSeq`
 * (0 for a full read of an empty conversation). So after applying the response a
 * client's new cursor is always `latestSeq`, and an empty `chunks` means
 * "nothing new past your cursor". CAVEAT (windowed reads): `latestSeq` is a
 * TAIL-sync cursor — on a `beforeSeq` backfill page (or any `limit`ed read that
 * did not reach the log's true tail) it describes the returned window, NOT the
 * conversation's high-water mark, so a client must not regress its sync cursor
 * from a backfill response. (A true server-side high-water mark independent of
 * the filter is deferred until a consumer needs it — it would require widening
 * the store contract.)
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
 * `turns` is every SEALED turn's `TurnMetrics` in turn order. A turn appears only
 * after its metrics were persisted (post-seal); an in-flight or unsealed turn is
 * absent until then.
 */
export interface ConversationMetricsResponse {
	readonly turns: readonly TurnMetrics[];
}

/** The aggregation window for `GET /metrics/throughput`. */
export type ThroughputPeriod = "day" | "week" | "month";

/**
 * One model's throughput over a period. `tokensPerSecond` is the TOKEN-WEIGHTED
 * average — `Σ(output tokens) / Σ(generation seconds)` across the period's
 * turns — so larger turns count proportionally more than smaller ones.
 * Generation time is the model's pure decode time (it excludes tool-execution
 * waits).
 */
export interface ThroughputModelStat {
	/** The model name in `<credentialName>/<model>` form (as selected). */
	readonly model: string;
	/** Token-weighted average tokens/second over the period. */
	readonly tokensPerSecond: number;
	/** Total output tokens generated across the period's turns. */
	readonly totalOutputTokens: number;
	/** Total pure generation time across the period's turns, in milliseconds. */
	readonly totalGenMs: number;
	/** Number of turns that contributed. */
	readonly turns: number;
}

/**
 * Response body for
 * `GET /metrics/throughput?period=day|week|month&date=<...>`.
 *
 * `date` is `YYYY-MM-DD` for day/week (week = the ISO Mon–Sun week containing
 * that date) and `YYYY-MM` for month. Boundaries are computed in the server's
 * local timezone; `start`/`end` are the resolved half-open `[start, end)` range
 * in epoch-ms. `models` lists every model active in the window, sorted by
 * `tokensPerSecond` descending.
 */
export interface ThroughputResponse {
	readonly period: ThroughputPeriod;
	readonly date: string;
	/** Inclusive start of the window, epoch-ms. */
	readonly start: number;
	/** Exclusive end of the window, epoch-ms. */
	readonly end: number;
	readonly models: readonly ThroughputModelStat[];
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

// ─── Per-conversation reasoning effort ────────────────────────────────────────

/**
 * Response of `GET /conversations/:id/reasoning-effort`. `reasoningEffort` is
 * null when never set (the server then resolves turns at the default,
 * `"high"`).
 */
export interface ReasoningEffortResponse {
	readonly conversationId: string;
	readonly reasoningEffort: ReasoningEffort | null;
}

/**
 * Body of `PUT /conversations/:id/reasoning-effort` — persists the
 * conversation's sticky reasoning-effort level (used for every later turn that
 * does not carry a per-turn `ChatRequest.reasoningEffort` override). An
 * unrecognized level → HTTP 400 `{ error }`.
 */
export interface SetReasoningEffortRequest {
	readonly reasoningEffort: ReasoningEffort;
}

// ─── Conversation close (explicit tab close) ──────────────────────────────────

/**
 * Response of `POST /conversations/:id/close` (no request body).
 *
 * The EXPLICIT "the user closed this conversation's tab" affordance — distinct
 * from a socket disconnect or `chat.unsubscribe`, which deliberately never touch
 * the turn or the warming schedule. Closing:
 *  1. aborts any in-flight turn (the kernel stops at the next event boundary,
 *     partial messages are persisted, and the turn SEALS normally with
 *     `finishReason: "aborted"` — watchers see `done` + `turn-sealed`), and
 *  2. stops + disables cache-warming for the conversation (persisted OFF, so a
 *     reopened conversation stays opt-in).
 * Idempotent: closing an idle or unknown conversation succeeds with
 * `abortedTurn: false`.
 */
export interface CloseConversationResponse {
	readonly conversationId: string;
	/** True when an in-flight turn existed and was aborted by this close. */
	readonly abortedTurn: boolean;
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

/**
 * Request body for `POST /chat/warm` — manually trigger a prompt-cache WARMING
 * request for a conversation (e.g. a frontend "warm now" button, or fast tests
 * that don't want to wait for the automatic warming timer).
 *
 * The warm replays the conversation's existing prefix to the provider to refresh
 * its prompt cache; it is NEVER persisted and NEVER streamed (no `AgentEvent`s).
 * Pass the same `model`/`cwd` the conversation chats with so the warm request's
 * prefix is byte-identical to a real turn (which is what makes the cache hit).
 */
export interface WarmRequest {
	/** The conversation whose prompt cache to warm. */
	readonly conversationId: string;

	/**
	 * The model name in `<credentialName>/<model>` form the conversation uses, so
	 * the warm resolves the same provider + prefix. Omit to use the server default.
	 */
	readonly model?: string;

	/** Working directory matching the conversation's turns (for cwd-aware tool assembly). */
	readonly cwd?: string;
}

/**
 * Response body for `POST /chat/warm` (HTTP 200). The warm request's usage —
 * never folded into the conversation's real usage. A client surfaces `cachePct`
 * as the "last warming" cache-hit indicator.
 *
 * When warming cannot run because the conversation is currently generating, the
 * server responds `409` with `{ error }` instead of this body.
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
	 * sum is 0). For a healthy warm this is ~**100%** (the whole prefix was still
	 * cached); it drops toward 0 as the cache expires/busts and the warm has to rewrite
	 * it. This is the warming HEALTH signal — distinct from `cachePct` (which a warm's
	 * tiny fresh probe makes ~equal, but which on a real turn reflects new content).
	 */
	readonly expectedCacheRate: number;
}

// ─── WebSocket chat ops ───────────────────────────────────────────────────────
// The persistent WS connection multiplexes chat ops (below) with surface ops
// (`@dispatch/ui-contract`). The unified unions at the bottom compose both. Chat
// `type`s are namespaced (`chat.*`) so they never collide with surface ones.

/**
 * Client → server: start or continue a turn over the WS connection. Carries the
 * same fields as the HTTP `ChatRequest` (so one shape drives both transports);
 * omit `conversationId` to start fresh — the resolved id arrives on the streamed
 * `AgentEvent`s (each carries `conversationId`).
 */
export interface ChatSendMessage extends ChatRequest {
	readonly type: "chat.send";
}

/**
 * Server → client: one `AgentEvent` from an in-flight turn (text-delta,
 * tool-call, usage, done, turn-sealed, …). The client folds these into its
 * transcript exactly as it folds the HTTP NDJSON stream — same events, different
 * carrier.
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

/**
 * Client → server: start WATCHING a conversation's live turn events WITHOUT
 * sending a message. This is what makes a turn viewable independently of who
 * started it — a second device (multi-client handoff) or a client that reloaded
 * mid-turn subscribes to receive the in-flight turn.
 *
 * On subscribe the server replays the CURRENT in-flight turn's events so far as
 * `chat.delta` messages (so a late-joiner sees the whole running turn from its
 * `turn-start`), then streams subsequent live events. If no turn is in-flight,
 * nothing is replayed (the client relies on `GET /conversations/:id` history).
 * A client infers "generating" from a replayed `turn-start` with no matching
 * `done`/`turn-sealed` yet. Idempotent per `(connection, conversationId)`.
 *
 * NOTE: `chat.send` auto-subscribes the sending connection, so a client only needs
 * `chat.subscribe` for conversations it is viewing but did not send to.
 */
export interface ChatSubscribeMessage {
	readonly type: "chat.subscribe";
	readonly conversationId: string;
}

/**
 * Client → server: stop watching a conversation's turn events on this connection.
 * Does NOT stop or affect the turn itself (the turn runs to completion regardless
 * of subscribers). The server also drops all of a connection's subscriptions when
 * the socket closes — again WITHOUT aborting any in-flight turn.
 */
export interface ChatUnsubscribeMessage {
	readonly type: "chat.unsubscribe";
	readonly conversationId: string;
}

/**
 * Every client → server WS message: surface ops (`@dispatch/ui-contract`) + chat
 * ops. A server discriminates on `type`.
 */
export type WsClientMessage =
	| SurfaceClientMessage
	| ChatSendMessage
	| ChatSubscribeMessage
	| ChatUnsubscribeMessage;

/**
 * Every server → client WS message: surface ops (`@dispatch/ui-contract`) + chat
 * ops. A client discriminates on `type`.
 */
export type WsServerMessage = SurfaceServerMessage | ChatDeltaMessage | ChatErrorMessage;
```
