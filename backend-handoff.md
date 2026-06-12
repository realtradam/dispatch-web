# Backend handoff — LIVING doc (FE ⇄ backend, couriered by the user)

> **Purpose:** the single rolling document the FE orchestrator keeps current so the user can hand off
> the whole FE↔backend seam at any time — on completion OR at a roadblock. Updated continuously.
> **From:** dispatch-web orchestrator · **To:** arch-rewrite orchestrator · **Courier:** the user.
> `lsp` does NOT span the repos (ORCHESTRATOR §5) — every cross-repo ask flows through here.

_Last updated: 2026-06-12. **FE is current on `transport-contract@0.8.0` / `wire@0.6.0`.** All handoffs
to date are consumed: surfaces + WS, conversation transcript/metrics, tabs + model selector,
cache-warming (incl. authoritative timer + retention + cache-rate fix), **per-conversation cwd + LSP
status**, **context size** (the `contextSize` field — `done` live + `TurnMetrics` persisted —
rendered as a current-usage readout above the composer), and **turn continuity + multi-client live
view** (`chat.subscribe`/`chat.unsubscribe`; re-attach to a running turn on reconnect/reload/second
device; stream-derived "generating…" state).
**Open asks:** CR-1 (Loaded Extensions as a real table) + CR-2 (optional catalog `scope` flag) below.
**CR-3 (watcher couldn't see the USER prompt until seal) → RESOLVED ✅** — backend shipped the
`user-message` turn event (`wire@0.6.0` / `transport-contract@0.8.0`); FE re-pinned + consumption live.
The cwd/LSP draft-path verification (`backend-handoff-cwd-lsp.md`) came back **all ✅ confirmed** by the
backend (answers in their `frontend-lsp-cwd-handoff.md`) — see §2._

**Turn-continuity handoff (`frontend-turn-continuity-handoff.md`) → CONSUMED ✅.** Re-pinned
`transport-contract@0.6.0→0.7.0` (additive; `wire` unchanged at `0.5.0`); re-mirrored
`.dispatch/transport-contract.reference.md` with `ChatSubscribeMessage`/`ChatUnsubscribeMessage` + the
widened `WsClientMessage` union. FE now: re-subscribes `chat.subscribe` for EVERY open conversation on
page load + on WS (re)connect (and on close sends `chat.unsubscribe`); `chat.send` still auto-subscribes
the sender, so the draft/promotion path adds none. A pure `generating` flag is folded structurally in
`core/chunks` (`turn-start`/deltas ⇒ true; `done`/`turn-sealed`/`error` ⇒ false; NOT inferred from the
free-form `status` string) and surfaced as `ChatStore.generating` → the Composer status icon now shows a
"running" spinner for any watching client. `ChatStore.resync()` (called from `onReopen`) clears a stale
spinner then pulls a turn that sealed while disconnected from history. 558 tests green. NO new backend
ask. NOT yet live-probed — needs the two-WS / second-device manual check from the handoff's "Quick
manual check" against a running backend.

**Context-size handoff (`frontend-context-size-handoff.md`) → CONSUMED ✅.** Re-pinned `wire@0.4.0→0.5.0`
+ `transport-contract@0.5.0→0.6.0`; re-mirrored both `.dispatch/*.reference.md`; added "context size" +
"context window" to FE `GLOSSARY.md`. `core/metrics` now threads `contextSize` through the `done` fold +
durable metrics and exposes `selectCurrentContextSize` (LATEST turn's defined value, `undefined`⇒unknown,
never `0`, durable-wins-over-live); the chat store exposes `currentContextSize`; `ContextSizeBadge`
renders "N tokens in context" / "context size unknown" above the composer. 533 tests green. NO new
backend ask — but the max-limit denominator is now a live FE need; see §3.

---

## 1. Pinned backend contracts (consumed by the FE)

Pinned as `file:` deps: **`ui-contract@0.1.0`; `wire@0.6.0`; `transport-contract@0.8.0`**.

| Package | Used for |
|---|---|
| `@dispatch/ui-contract` | surfaces + surface WS protocol |
| `@dispatch/wire` | `Chunk`/`StoredChunk`(+`seq`)/`ChatMessage`/`AgentEvent`/`TurnSealedEvent`/`Usage`/`StepId` + metrics: `StepMetrics`/`TurnMetrics`, `usage.stepId`, `step-complete`, `done.durationMs`/`done.usage`, `tool-result.durationMs`, **`done.contextSize`/`TurnMetrics.contextSize`** |
| `@dispatch/transport-contract` | `ChatRequest`/`ModelsResponse`/`ConversationHistoryResponse`/`ConversationMetricsResponse` + `WarmRequest`/`WarmResponse` + `CwdResponse`/`SetCwdRequest` + LSP (`LspStatusResponse`/`LspServerInfo`/`LspServerState`) + WS chat ops + `WsClientMessage`/`WsServerMessage` |

Endpoints in use (HTTP **24203**, WS **24205**, CORS `*` incl. `PUT`):
`POST /chat` (NDJSON) · `GET /models` · `GET /conversations/:id?sinceSeq=<n>` ·
`GET /conversations/:id/metrics` · `GET`/`PUT /conversations/:id/cwd` ·
`GET /conversations/:id/lsp` · `POST /chat/warm` · WS `chat.send`→`chat.delta` ·
WS `chat.subscribe`/`chat.unsubscribe` (watch a conversation's turns without sending; replay + live).

Mirrored in-repo for headless agents: `.dispatch/{ui-contract,wire,transport-contract}.reference.md`
(regenerate on any contract bump; all current as of `transport-contract@0.6.0` / `wire@0.5.0`).

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

### cwd + LSP draft path → **VERIFIED ✅ (all 6 asks confirmed; courier `backend-handoff-cwd-lsp.md`)**

The backend confirmed all six asks (answers in their `frontend-lsp-cwd-handoff.md`, code refs
`transport-http/src/app.ts` + `session-orchestrator/src/orchestrator.ts`; live-verified): unseen-id
`GET /cwd`⇒`{cwd:null}` and `GET /lsp`⇒`{cwd:null,servers:[]}` (no 404/500); `PUT /cwd` on a draft id
upserts by key; **draft cwd carries into turn 1** when `/chat` omits `cwd`; CORS preflight for `PUT` is
answered; no LSP spawn while `cwd` is null; errors are `{error:string}`. **No backend change needed —
the draft→first-message cwd path the FE built is fully supported.**

**FE invariant to KEEP (don't regress):** the chat send must **omit** `cwd` (send `undefined`), never
`cwd:""`/`cwd:null`. The `/chat` `cwd` field treats any non-`undefined` value as "provided", so a literal
empty would override the persisted draft cwd. Verified safe today: `chat/store.svelte.ts` builds
`chat.send` with only `type`/`conversationId`/`message`/`model` — no `cwd` field. (The backend offered to
harden `/chat` to treat blank as "not provided" if we ever want it — not needed while we omit the field.)

### CR-3 (BUG, multi-client) → **RESOLVED ✅** (Option B shipped; courier `frontend-cr3-user-message-handoff.md`)

The backend implemented Option B + live-verified it: a new `AgentEvent` member `TurnInputEvent`
(`{ type: "user-message"; conversationId; turnId; text }`) is emitted as the FIRST event of every turn
(before `turn-start`), buffered + replayed to live AND late-join subscribers. `wire@0.5.0→0.6.0`,
`transport-contract@0.7.0→0.8.0` (re-exports the union; no transport-shape change). **FE consumed:**
re-pinned both, re-mirrored `.dispatch/{wire,transport-contract}.reference.md`, promoted the staged
`core/chunks` fold to a typed `case "user-message"` (appends the prompt with a text de-dup vs the sender's
optimistic echo), and added `user-message` to the FE exhaustiveness guard. A pure watcher now shows the user
bubble the moment the turn starts. The original report follows for history.

**Symptom (reproduced live):** open a conversation in two windows; window A sends a message. Window B
(`chat.subscribe`, a pure watcher) renders the streaming **reply** but NOT the user **prompt** that
triggered it — the user bubble only pops in after `turn-sealed`.

**Root cause (backend):** the user prompt is never part of the turn's live/replayable stream, and isn't
persisted until the turn ends — so a watcher has no source for it mid-turn.
- The replay buffer holds only `AgentEvent`s (`session-orchestrator/src/orchestrator.ts` `ActiveTurn.buffer`,
  pushed in `emitToHub`). `buildUserMessage(text)` (`pure.ts`) is passed straight to the provider and is
  **never `emitToHub`'d** → not buffered, not replayed.
- The prompt is persisted only at turn end, atomically with the reply: `orchestrator.ts:244-245`
  (`toPersist = [userMsg, ...result.messages]; conversationStore.append(...)`), just before `turn-sealed`.
  So a mid-turn `GET /conversations/:id` returns nothing for it either.

The sender looks fine only because the FE optimistically echoes its own prompt; a pure watcher never sent,
so it has nothing to show. **No FE-only fix is possible** — the prompt text simply isn't sent until seal.

**Requested fix — Option B (preferred): emit the prompt into the turn's event stream.**
- **`@dispatch/wire` (additive):** add a `TurnInputEvent` to the `AgentEvent` union, e.g.
  `{ type: "user-message"; conversationId: string; turnId: string; text: string }`. Bump `wire`.
- **`session-orchestrator`:** `emitToHub(conversationId, { type: "user-message", conversationId, turnId, text })`
  at the very start of `runTurnDetached` (before `runTurn`), so it is the first buffered event → replayed to
  every subscriber, live and late-join. (No `runTurn`/kernel change needed — the orchestrator already holds
  `text` + `turnId` + the hub.)
- Emitting it (and only it) does not change persistence semantics; the existing seal-time append is unchanged.

**FE side — already staged (inert until you ship it):** `core/chunks` folds a `user-message` event into a
provisional user chunk for watchers, with a content dedup so the sender's optimistic echo isn't duplicated
(`reducer.ts` forward-compat branch + tests). The moment the backend emits `user-message`, both windows show
the prompt immediately; nothing breaks before then. On the new `wire`, we'll re-pin + re-mirror + add it to
the FE exhaustiveness guard.

**Alternative — Option A (no wire change):** persist the user message at turn START (append `[userMsg]`
before `runTurn`; append only `result.messages` at seal) — then watchers fetch it via history. We do NOT
prefer this: it needs an extra history round-trip per watched turn and changes persistence semantics (an
errored turn would leave a persisted prompt with no reply).

## 3. Likely NEXT backend asks (heads-up, not yet requested)

- **Model max context-window LIMIT** (the denominator for context size) — the context-size handoff
  flagged this as the separate, later field. **The FE already renders `contextSize / limit · pct%` + a
  fill bar in the composer status bar, but the limit is currently HARDCODED to `1,000,000` as a
  placeholder** (`MAX_CONTEXT` in `features/chat/ui/Composer.svelte`; GLOSSARY "context window" notes it).
  When a per-model/per-turn `contextWindow` (max token capacity) ships, wire the real value through (drop
  the hardcode) so the bar/percent are accurate. **Likely the next ask** — raise when the backend can
  source the model's advertised window.
- `GET /conversations` — conversation list / sidebar (history explorer / switcher); could also expose a
  per-conversation "last model" so a reopened tab seeds its model from the server instead of localStorage.
- `POST /conversations/:id/cancel` — "stop generating".
- **LSP status over WS** (push) — today the FE HTTP-polls `GET /conversations/:id/lsp` on panel mount /
  cwd change + a manual refresh; a live surface/WS push would remove the manual refresh and reflect a
  server flipping to `error`/`connected` without a reload. (Backend flagged this as a future option.)
