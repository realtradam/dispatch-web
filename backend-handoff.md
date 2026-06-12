# Backend handoff — LIVING doc (FE ⇄ backend, couriered by the user)

> **Purpose:** the single rolling document the FE orchestrator keeps current so the user can hand off
> the whole FE↔backend seam at any time — on completion OR at a roadblock. Updated continuously.
> **From:** dispatch-web orchestrator · **To:** arch-rewrite orchestrator · **Courier:** the user.
> `lsp` does NOT span the repos (AGENTS.md § Backend seam) — every cross-repo ask flows through here.

_Last updated: 2026-06-12 (CR-4 consumed). **FE is current on `ui-contract@0.2.0` /
`transport-contract@0.9.0` / `wire@0.6.0`.** All handoffs to date are consumed: surfaces + WS,
conversation transcript/metrics, tabs + model selector, cache-warming (incl. authoritative timer +
retention + cache-rate fix + the CR-4 lifecycle below), **per-conversation cwd + LSP status**,
**context size**, and **turn continuity + multi-client live view**.
**Open asks: NONE.** CR-1/CR-2/CR-4 all RESOLVED ✅ (see §2); §3 lists likely next asks.
**CR-3 (watcher couldn't see the USER prompt until seal) → RESOLVED ✅** — backend shipped the
`user-message` turn event; FE re-pinned + consumption live.
The cwd/LSP draft-path verification (`backend-handoff-cwd-lsp.md`) came back **all ✅ confirmed**._

**CR-4 cache-warming lifecycle (`frontend-cache-warming-lifecycle-handoff.md`) → CONSUMED ✅
(live-probed 17/17 against `bin/up`).** Re-pinned `ui-contract@0.1.0→0.2.0` +
`transport-contract@0.8.0→0.9.0` (`wire` unchanged); re-mirrored both `.dispatch/*.reference.md`. FE
work: `store.closeTab()` now POSTs `POST /conversations/:id/close` (fire-and-forget, idempotent) —
the explicit "done with this chat" affordance that aborts an in-flight turn + stops/disables that
conversation's warming, while disconnect/`chat.unsubscribe` still leave both running;
`syncSubscriptions` honors the new catalog `scope` flag (a `scope:"global"` surface is no longer
re-subscribed on every conversation switch; absent = conversation-scoped, conservative);
`secondsUntilNext` gained a 3s belt-and-braces stale guard (a past `nextWarmAt` renders "waiting…",
should never trigger now). **CR-4d correction: the missing `conversationId` echo on the initial
`surface` message was OURS** — the backend was right, HEAD echoes it; our WS parser
(`adapters/ws/logic.ts` `case "surface"`) rebuilt the message and DROPPED the field. Fixed + unit
tests; the protocol reducer's stale-scope filtering now actually bites on the initial reply too.
Probe verified live: default OFF + nothing scheduled on a fresh conversation; toggle-on/interval
updates carry FUTURE `nextWarmAt`; repeated automatic warms each push a FUTURE `nextWarmAt`;
`nextWarmAt: null` pushed on `turn-start`; close mid-turn → 200 `abortedTurn:true`, watcher gets
`done` `reason:"aborted"` + `turn-sealed`, surface flips `enabled:false`/`nextWarmAt:null`; second
close idempotent (`abortedTurn:false`). CR-1 table payload also verified arriving (FE renderer
pre-existing). 568 tests green._

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

Pinned as `file:` deps: **`ui-contract@0.2.0`; `wire@0.6.0`; `transport-contract@0.9.0`**.

| Package | Used for |
|---|---|
| `@dispatch/ui-contract` | surfaces + surface WS protocol |
| `@dispatch/wire` | `Chunk`/`StoredChunk`(+`seq`)/`ChatMessage`/`AgentEvent`/`TurnSealedEvent`/`Usage`/`StepId` + metrics: `StepMetrics`/`TurnMetrics`, `usage.stepId`, `step-complete`, `done.durationMs`/`done.usage`, `tool-result.durationMs`, **`done.contextSize`/`TurnMetrics.contextSize`** |
| `@dispatch/transport-contract` | `ChatRequest`/`ModelsResponse`/`ConversationHistoryResponse`/`ConversationMetricsResponse` + `WarmRequest`/`WarmResponse` + `CwdResponse`/`SetCwdRequest` + LSP (`LspStatusResponse`/`LspServerInfo`/`LspServerState`) + WS chat ops + `WsClientMessage`/`WsServerMessage` |

Endpoints in use (HTTP **24203**, WS **24205**, CORS `*` incl. `PUT`):
`POST /chat` (NDJSON) · `GET /models` · `GET /conversations/:id?sinceSeq=<n>` ·
`GET /conversations/:id/metrics` · `GET`/`PUT /conversations/:id/cwd` ·
`GET /conversations/:id/lsp` · `POST /chat/warm` · `POST /conversations/:id/close` (explicit
tab-close: abort turn + stop/disable warming) · WS `chat.send`→`chat.delta` ·
WS `chat.subscribe`/`chat.unsubscribe` (watch a conversation's turns without sending; replay + live).

Mirrored in-repo for headless agents: `.dispatch/{ui-contract,wire,transport-contract}.reference.md`
(regenerate on any contract bump; all current as of `ui-contract@0.2.0` /
`transport-contract@0.9.0` / `wire@0.6.0`).

## 2. Open asks FOR THE BACKEND

**None open.** Resolved history below.

### CR-1 — Loaded Extensions as a true table → **RESOLVED ✅** (shipped + consumed)

Backend now emits the "Loaded" count stat plus ONE
`{ kind: "custom", rendererId: "table", payload: { columns, rows } }` field
(`columns: ["Name", "Version", "Trust", "Activation"]`, one row per loaded extension, all trust
tiers). Verified arriving live; the FE's pre-existing `SurfaceTable` renderer (dispatch on
`rendererId === "table"`) shows it with no FE change. A typed `TablePayload` (+ `TABLE_RENDERER_ID`)
is exported from `@dispatch/surface-loaded-extensions` if we ever want to narrow instead of
duck-typing — not consumed (would add a dep for no behavior change). Data-quality note stands:
`Version` cells all read `0.0.0` (manifests genuinely unversioned; optional backend cleanup).

### CR-2 — catalog `scope` flag → **RESOLVED ✅** (`ui-contract@0.2.0`, consumed)

`SurfaceCatalogEntry.scope?: "global" | "conversation"` shipped (emitted: `loaded-extensions` →
global, `cache-warming` → conversation). FE consumed: `syncSubscriptions` subscribes a
`scope:"global"` surface WITHOUT a conversationId, so a conversation switch no longer churns a
redundant unsubscribe+subscribe per global surface. ABSENT scope = assume conversation-scoped
(conservative, per contract).

### CR-4 — cache-warming lifecycle → **RESOLVED ✅** (courier `backend-handoff-cache-warming.md`; reply `frontend-cache-warming-lifecycle-handoff.md`; live-probed 17/17)

All four asks shipped + consumed (`transport-contract@0.9.0`):
- **(a) default OFF** for a new conversation (interval default still 240s; re-enable restores the
  persisted interval). Verified live.
- **(b) FUTURE `nextWarmAt`** pushed after every automatic warm + after `turn-sealed`;
  `nextWarmAt: null` pushed on `turn-start` (FE renders "waiting…" while generating) and when
  disabled. Verified live (2 automatic warms @10s, both future).
- **(c) `POST /conversations/:id/close`** (`CloseConversationResponse { conversationId,
  abortedTurn }`): aborts an in-flight turn (partial persisted, seals with `reason: "aborted"` →
  watchers' `generating` clears structurally) + stops/disables warming (persisted OFF), idempotent;
  disconnect/`chat.unsubscribe` still never touch either. FE wires it in `store.closeTab()`
  (fire-and-forget). Verified live incl. mid-turn abort + idempotent re-close.
- **(d) `conversationId` echo on the initial `surface` message — was an FE BUG, not backend.**
  The backend's frame carries it (raw-frame verified); our WS parser
  (`adapters/ws/logic.ts` `case "surface"`) rebuilt the message and dropped the field. Fixed FE-side
  + unit-tested; stale-scope filtering now applies to the initial reply too. Backend owes nothing.

**Known caveat (accepted, fail-safe):** the warming opt-in is NOT re-hydrated across a backend
RESTART — a conversation reads disabled until toggled again. Flag to the backend if persistence
across restarts becomes a product need (they offered boot hydration).

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
- ~~`POST /conversations/:id/cancel`~~ — **superseded by `POST /conversations/:id/close`
  (CR-4c, shipped)**. A standalone "stop generating WITHOUT closing/disabling warming" button would
  still need a separate affordance if the product ever wants it.
- **Warming opt-in persistence across backend restarts** — currently fail-safe-off after a restart;
  backend offered boot hydration if it becomes a need (see CR-4 caveat in §2).
- **LSP status over WS** (push) — today the FE HTTP-polls `GET /conversations/:id/lsp` on panel mount /
  cwd change + a manual refresh; a live surface/WS push would remove the manual refresh and reflect a
  server flipping to `error`/`connected` without a reload. (Backend flagged this as a future option.)
