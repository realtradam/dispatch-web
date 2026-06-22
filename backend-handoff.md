# Backend handoff — LIVING doc (FE ⇄ backend, couriered by the user)

> **Purpose:** the single rolling document the FE orchestrator keeps current so the user can hand off
> the whole FE↔backend seam at any time — on completion OR at a roadblock. Updated continuously.
> **From:** dispatch-web orchestrator · **To:** arch-rewrite orchestrator · **Courier:** the user.
> `lsp` does NOT span the repos (AGENTS.md § Backend seam) — every cross-repo ask flows through here.

_Last updated: 2026-06-22 (context window + percentage-based compact consumed).
**FE is current on `ui-contract@0.2.0` / `transport-contract@0.15.0` / `wire@0.11.0`.** 686 tests green.
**Open asks: NONE.** All CRs resolved (CR-1 through CR-6) + context-window + compact-percent
handoff consumed._

---

## 1. Pinned backend contracts (consumed by the FE)

Pinned as `file:` deps: **`ui-contract@0.2.0`; `wire@0.11.0`; `transport-contract@0.15.0`**.

| Package | Used for |
|---|---|
| `@dispatch/ui-contract` | surfaces + surface WS protocol |
| `@dispatch/wire` | `Chunk`/`StoredChunk`(+`seq`)/`ChatMessage`/`AgentEvent`/`TurnSealedEvent`/`Usage`/`StepId` + metrics: `StepMetrics`/`TurnMetrics`, `usage.stepId`, `step-complete`, `done.durationMs`/`done.usage`, `tool-result.durationMs`, `done.contextSize`/`TurnMetrics.contextSize`, `ReasoningEffort`, `QueuedMessage`/`QueuePayload`/`TurnSteeringEvent`, `ConversationMeta`/`ConversationStatus` |
| `@dispatch/transport-contract` | `ChatRequest`(+`reasoningEffort`)/`ModelsResponse`/`ConversationHistoryResponse`/`ConversationMetricsResponse` + `WarmRequest`/`WarmResponse` + `CwdResponse`/`SetCwdRequest` + `ReasoningEffortResponse`/`SetReasoningEffortRequest` + `QueueRequest`/`QueueResponse`/`ChatQueueMessage` + `ConversationOpenMessage`/`ConversationStatusChangedMessage`/`ConversationListResponse`/`LastMessageResponse`/`OpenConversationResponse`/`SetTitleRequest`/`TitleResponse` + LSP (`LspStatusResponse`/`LspServerInfo`/`LspServerState`) + WS chat ops + `WsClientMessage`/`WsServerMessage` |

Endpoints in use (HTTP **24203**, WS **24205**, CORS `*` incl. `PUT`):
`POST /chat` (NDJSON) · `GET /models` ·
`GET /conversations/:id?sinceSeq=<n>&beforeSeq=<s>&limit=<k>` (CR-5 windowing) ·
`GET /conversations/:id/metrics` · `GET`/`PUT /conversations/:id/cwd` ·
`GET`/`PUT /conversations/:id/reasoning-effort` (sticky thinking-depth; `null` ⇒ default `high`) ·
`GET /conversations/:id/lsp` · `POST /chat/warm` · `POST /conversations/:id/close` (explicit
tab-close: abort turn + stop/disable warming) · `POST /conversations/:id/queue` (enqueue
steering message; auto-starts a turn if idle) · WS `chat.send`→`chat.delta` ·
WS `chat.subscribe`/`chat.unsubscribe` (watch a conversation's turns without sending; replay + live) ·
WS `chat.queue` (enqueue steering; fire-and-forget — surface updates on success) ·
WS `conversation.open` (broadcast: CLI `--open` flag signals the FE to open/focus a tab) ·
WS `conversation.statusChanged` (broadcast: lifecycle status change — `active`/`idle`/`closed`).

Mirrored in-repo for headless agents: `.dispatch/{ui-contract,wire,transport-contract}.reference.md`
(regenerate on any contract bump; all current as of `ui-contract@0.2.0` /
`transport-contract@0.15.0` / `wire@0.11.0`).

### FE invariants to keep (don't regress)

- **`chat.send` must omit `cwd`** (send `undefined`), never `cwd:""`/`cwd:null`. The `/chat` `cwd`
  field treats any non-`undefined` value as "provided". Verified safe: `chat/store.svelte.ts` builds
  `chat.send` with only `type`/`conversationId`/`message`/`model` — no `cwd` field.
- **Per-conversation seqs are 1-based, monotonic, gap-free** (CR-5 contractual guarantee on
  `StoredChunk`). The FE derives `hasOlder = oldestLoaded.seq > 1`.
- **Warming opt-in is NOT re-hydrated across a backend restart** — a conversation reads disabled
  until toggled again (fail-safe). Backend offered boot hydration if it becomes a product need.

---

## 2. Open asks FOR THE BACKEND

### CR-6 — Assign seq during generation → **RESOLVED ✅** (backend shipped; FE adoption pending)

The backend now persists chunks **incrementally at step boundaries** during generation:
1. Turn starts → user message is `append`ed immediately (gets seq).
2. Each step completes → step's messages are `append`ed immediately (get seq).
3. Turn seals → `turn-sealed` emitted (no batch append needed — already persisted).

`GET /conversations/:id?sinceSeq=N` returns committed, seq'd chunks **during generation**. The
FE's existing `syncTail` already polls this — it will find new chunks as each step completes. No
wire/transport-contract change needed (`StoredChunk` already has `seq`; `AgentEvent` types unchanged).

**FE adoption: NOT pursuing syncTail-during-generation.** Investigation revealed
the kernel emits `step-complete` (line 360 of `run-turn.ts`) BEFORE calling
`onStepComplete` (line 542) — the step's chunks are persisted only AFTER tool
results come back, not when `step-complete` fires. So `syncTail` triggered by
`step-complete` finds nothing. Moving the emission after `onStepComplete` would
be a kernel change.

Instead, the FE now trims provisional chunks directly in `trimTranscript` when
committed is exhausted — no `syncTail` needed. Dropped provisional chunks are
lost temporarily (no "Show earlier" for them) but come back as committed when
the turn seals and `syncTail` fetches everything.

---

### Resolved CRs (for reference)

| CR | Summary | Status |
|---|---|---|
| CR-1 | Loaded Extensions as a true table (`rendererId: "table"`) | ✅ shipped + consumed |
| CR-2 | catalog `scope` flag (`"global"` / `"conversation"`) | ✅ `ui-contract@0.2.0` |
| CR-3 | `user-message` event (watcher sees user prompt mid-turn) | ✅ `wire@0.6.0` |
| CR-4 | cache-warming lifecycle (default OFF, future `nextWarmAt`, `POST /close`) | ✅ `transport-contract@0.9.0` |
| CR-5 | history windowing (`?limit=`, `?beforeSeq=`, 1-based gap-free seqs) | ✅ `wire@0.6.1` / `transport-contract@0.10.0` |
| CR-6 | Assign seq during generation (incremental persist at step boundaries) | ✅ shipped; FE adoption pending |

---

## 3. Likely NEXT backend asks (heads-up, not yet requested)

- **Model max context-window LIMIT** → **CONSUMED ✅** — `GET /models` now returns
  `modelInfo[model].contextWindow`. The Composer uses the real value (falls back to
  1,000,000 when absent). The hardcoded `MAX_CONTEXT` is gone.
- **Percentage-based auto-compact** → **CONSUMED ✅** — `compact-threshold` endpoint
  renamed to `compact-percent`; field is now `percent` (0-100, default 85, 0 = manual).
  CompactionView UI updated from token count to percent input (0-100).
- **`GET /conversations`** — conversation list / sidebar (history explorer / switcher); could also
  expose a per-conversation "last model" so a reopened tab seeds its model from the server.
- **LSP status over WS** (push) — today the FE HTTP-polls `GET /conversations/:id/lsp` on panel mount
  / cwd change + a manual refresh; a live surface/WS push would remove the manual refresh and reflect
  a server flipping to `error`/`connected` without a reload.
