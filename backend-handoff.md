# Backend handoff — LIVING doc (FE ⇄ backend, couriered by the user)

> **Purpose:** the single rolling document the FE orchestrator keeps current so the user can hand off
> the whole FE↔backend seam at any time — on completion OR at a roadblock. Updated continuously.
> **From:** dispatch-web orchestrator · **To:** arch-rewrite orchestrator · **Courier:** the user.
> `lsp` does NOT span the repos (ORCHESTRATOR §5) — every cross-repo ask flows through here.

_Last updated: 2026-06-11 — **Cache-rate fix + retention + CR-3 consumed FE-side** (from `frontend-cache-warming-handoff.md`): (1) per-turn cache rate now reads true on Claude (no FE change); (2) NEW cross-turn **expected cache (retention)** metric in the chat metrics bubble (`computeExpectedCachePct`/`viewExpectedCache`); (3) **CR-3 DONE & consumed** — the countdown is now AUTHORITATIVE off the surface's `cache-warming-timer` `nextWarmAt`/`lastWarmAt` (FE guessing dropped), history keyed off `lastWarmAt`, and `WarmResponse.expectedCacheRate` headlined on "Warm now"; (4) second "cache retention" `stat` parsed. transport mirror regenerated. **Earlier (same day):** `NumberField` + conversation-scoped subscriptions + "Cache Warming" sidebar view. Open asks: CR-1 (Loaded Extensions as a real multi-column table); CR-2 (optional catalog `scope` flag). **CR-3 is RESOLVED** (see §2)._

---

## 1. Pinned backend contracts (consumed by the FE)

Pinned as `file:` deps: **`ui-contract@0.1.0`; `wire@0.4.0`; `transport-contract@0.4.0`**.

| Package | Used for |
|---|---|
| `@dispatch/ui-contract` | surfaces + surface WS protocol |
| `@dispatch/wire` | `Chunk`/`StoredChunk`(+`seq`)/`ChatMessage`/`AgentEvent`/`TurnSealedEvent`/`Usage`/`StepId` + metrics: `StepMetrics`/`TurnMetrics`, `usage.stepId`, `step-complete`, `done.durationMs`/`done.usage`, `tool-result.durationMs` |
| `@dispatch/transport-contract` | `ChatRequest`/`ModelsResponse`/`ConversationHistoryResponse`/`ConversationMetricsResponse` + WS chat ops + `WsClientMessage`/`WsServerMessage` |

Endpoints in use (HTTP **24203**, WS **24205**, CORS `*`):
`POST /chat` (NDJSON) · `GET /models` · `GET /conversations/:id?sinceSeq=<n>` ·
`GET /conversations/:id/metrics` · WS `chat.send`→`chat.delta`.

Mirrored in-repo for headless agents: `.dispatch/{ui-contract,wire,transport-contract}.reference.md`
(regenerate on any contract bump).

**2026-06-11 re-mirror (cache-warming).** Both `ui-contract` and `transport-contract` were left at their
existing versions by the backend (`ui-contract@0.1.0`, `transport-contract@0.4.0`) but gained ADDITIVE
members; the `file:` deps already resolve them. The FE mirrors were regenerated to match:
- `ui-contract.reference.md`: `NumberField` (`kind:"number"`) + optional `conversationId?` on
  `Subscribe`/`Unsubscribe`/`Invoke`/`Surface`/`SurfaceUpdate`.
- `transport-contract.reference.md`: `POST /chat/warm` (`WarmRequest`/`WarmResponse`) + the throughput
  axis (`GET /metrics/throughput`, `ThroughputResponse`/`ThroughputModelStat`/`ThroughputPeriod`).
- FE consumed: generic `number` renderer; protocol keyed by `surfaceId` carrying the focused
  conversationId with a staleness rule (drop a `surface`/`update` echoing a non-current conversation;
  a global no-echo reply is always accepted); store auto-subscribes every catalog surface with the
  focused conversationId and re-scopes on conversation switch; `warmNow()` posts `/chat/warm` with the
  conversation's current model name.

## 2. Open asks FOR THE BACKEND

### CR-1 — emit the **Loaded Extensions** surface as a true table

The user wants the Loaded Extensions surface rendered as a nice multi-column
table (e.g. `Name | Version | Trust | Scope`), listing **all** loaded extensions.

**Already covered — do NOT redo these (no contract change needed):**
- The `custom` field kind + `rendererId` + graceful-skip already exist in
  `ui-contract@0.1.0`. CR-1 uses that escape hatch — no `@dispatch/ui-contract` bump.
- The FE renderer is **done and shipped**: `SurfaceView` → `SurfaceTable` →
  shared `Table`, dispatched on `rendererId === "table"`. It renders the moment
  the surface emits the field below.
- The FE already groups consecutive `stat` fields into an aligned 2-column
  (label → value) table, so the current surface (one `stat` per extension:
  name → version) is **already readable as a table today**. CR-1 is the upgrade
  to real columns, not a fix for something broken.
- The "frontend modules" half of the Extensions view is **100% FE-owned**
  (aggregated from each FE feature's `manifest`) — backend has nothing to provide there.

**What I NEED from the backend to finish it:** replace the N per-extension
`stat` fields with a SINGLE `custom` field:
```ts
{
  kind: "custom",
  rendererId: "table",
  payload: {
    columns: string[],                      // header labels
    rows: (string | number | boolean)[][],  // each row aligns cell-for-cell to columns
  },
}
```
- Cells are coerced to strings; a malformed payload renders nothing (safe skip).
- `rows` should enumerate **every** loaded extension (all trust tiers / kinds),
  so "show all" is satisfied from this one surface.

**Optional (data quality, not a blocker):** extension manifest `version`s all
read `0.0.0` (unversioned). If real versions should appear in the table column,
bump each extension's manifest `version` — otherwise the column is all `0.0.0`.

### CR-2 (optional, low priority) — a `scope` flag on the surface catalog entry

The catalog (`SurfaceCatalogEntry`) carries no hint of whether a surface is GLOBAL or
CONVERSATION-SCOPED, so the FE follows the handoff's "always send the focused `conversationId`"
policy. That works (global surfaces ignore it; the FE's routing accepts the no-echo global reply),
but it means the FE **re-subscribes every surface — including global ones like `loaded-extensions` —
on every conversation switch**, which is needless churn (one redundant unsubscribe+subscribe round
trip per global surface per switch; no user-visible bug, the old spec is retained so there's no
flicker). An optional `scope?: "global" | "conversation"` on `SurfaceCatalogEntry` would let the FE
skip re-subscribing globals on switch. **Not blocking** — only raise if cheap.

### CR-3 — next-warm timestamp + manual-warm timer reset → **RESOLVED ✅ (backend `bfbad3a`, consumed FE-side)**

Both asks shipped by the backend (no contract bump — `custom` escape hatch) and are now consumed:
1. **`nextWarmAt` / `lastWarmAt` (epoch-ms)** arrive on the conversation-scoped `cache-warming` surface
   as a `custom` field `{ rendererId: "cache-warming-timer", payload: { nextWarmAt, lastWarmAt } }`.
   FE: `parseControls` reads them; the countdown is now derived straight from `nextWarmAt`
   (`secondsUntilNext(nextWarmAt, now)`) and the history keys off `lastWarmAt` (`observeWarm`). The
   old FE best-effort anchor/guess logic was DELETED.
2. **Manual `POST /chat/warm` now re-arms the timer + pushes a surface `update`.** FE: dropped the
   workaround of recording history from the HTTP response — history is driven authoritatively by the
   surface's `lastWarmAt`; the HTTP `WarmResponse` is still used for the immediate "Warm now" feedback
   line (now headlining `expectedCacheRate`). The generic surface-host does NOT render
   `cache-warming-timer` (no registered renderer → graceful skip); the cache-warming feature owns it.

(The standalone courier `backend-handoff-cache-warming-timer.md` is now historical — no open asks.)

## 3. Likely NEXT backend asks (heads-up, not yet requested)

- `GET /conversations` — conversation list / sidebar (history explorer / switcher); could also expose a
  per-conversation "last model" so a reopened tab seeds its model from the server instead of localStorage.
- `POST /conversations/:id/cancel` — "stop generating".
