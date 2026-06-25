# Backend handoff — LIVING doc (FE ⇄ backend, couriered by the user)

> **Purpose:** the single rolling document the FE orchestrator keeps current so the user can hand off
> the whole FE↔backend seam at any time — on completion OR at a roadblock. Updated continuously.
> **From:** dispatch-web orchestrator · **To:** `../dispatch-backend` orchestrator · **Courier:** the user.
> `lsp` does NOT span the repos (AGENTS.md § Backend seam) — every cross-repo ask flows through here.

_Last updated: 2026-06-24 (`transport-contract` re-pinned 0.20.0 → 0.22.0; `file:` dep paths
fixed `../arch-rewrite` → `../dispatch-backend`; MCP server-status endpoint/types consumed + backend shipped
`GET /conversations/:id/mcp` (CR-12 resolved); transient `provider-retry` AgentEvent consumed (additive to
`wire@0.12.0`, no version bump))._
**FE is current on `ui-contract@0.2.0` / `transport-contract@0.22.0` / `wire@0.12.0`.** Open asks: **CR-9**
(`system:os` should detect WSL + include Linux distro — backend behavior change, no contract bump).
Backend shipped CR-10 (workspace id on `conversation.open` / `conversation.statusChanged`), CR-11
(per-conversation model persistence), and CR-12 (`GET /conversations/:id/mcp`); FE has consumed all three.
The backend also added the transient `provider-retry` `AgentEvent` (retry-with-backoff warning) to
`wire@0.12.0` (additive — no version bump); FE consumed + re-mirrored `.dispatch/wire.reference.md` — see §2c.
FE re-pinned + re-mirrored `transport-contract`; `selectModel` persists to
`PUT /conversations/:id/model` and conversation focus recalls the persisted model via `GET /conversations/:id/model`.
FE consumes the MCP status slice (`GET /conversations/:id/mcp`, mirroring `/lsp`) — see §2b.

---

## 1. Pinned backend contracts (consumed by the FE)

Pinned as `file:` deps: **`ui-contract@0.2.0`; `wire@0.12.0`; `transport-contract@0.22.0`**.

| Package | Used for |
|---|---|
| `@dispatch/ui-contract` | surfaces + surface WS protocol |
| `@dispatch/wire` | `Chunk`/`StoredChunk`(+`seq`)/`ChatMessage`/`AgentEvent`/`TurnSealedEvent`/`TurnProviderRetryEvent`(transient retry-warning)/`Usage`/`StepId` + metrics: `StepMetrics`/`TurnMetrics`, `usage.stepId`, `step-complete`, `done.durationMs`/`done.usage`, `tool-result.durationMs`, `done.contextSize`/`TurnMetrics.contextSize`, `ReasoningEffort`, `QueuedMessage`/`QueuePayload`/`TurnSteeringEvent`, `ConversationMeta`/`ConversationStatus` |
| `@dispatch/transport-contract` | `ChatRequest`(+`reasoningEffort`)/`ModelsResponse`/`ConversationHistoryResponse`/`ConversationMetricsResponse` + `WarmRequest`/`WarmResponse` + `CwdResponse`/`SetCwdRequest` + `ReasoningEffortResponse`/`SetReasoningEffortRequest` + `QueueRequest`/`QueueResponse`/`ChatQueueMessage` + `ConversationOpenMessage`/`ConversationStatusChangedMessage`/`ConversationListResponse`/`LastMessageResponse`/`OpenConversationResponse`/`SetTitleRequest`/`TitleResponse` + LSP (`LspStatusResponse`/`LspServerInfo`/`LspServerState`) + MCP (`McpStatusResponse`/`McpServerInfo`/`McpServerState`) + WS chat ops + `WsClientMessage`/`WsServerMessage` |

Endpoints in use (HTTP **24203**, WS **24205**, CORS `*` incl. `PUT`):
`POST /chat` (NDJSON) · `GET /models` ·
`GET /conversations/:id?sinceSeq=<n>&beforeSeq=<s>&limit=<k>` (CR-5 windowing) ·
`GET /conversations/:id/metrics` · `GET`/`PUT /conversations/:id/cwd` ·
`GET`/`PUT /conversations/:id/reasoning-effort` (sticky thinking-depth; `null` ⇒ default `high`) ·
`GET`/`PUT /conversations/:id/model` (sticky per-conversation model persistence) ·
`GET /conversations/:id/lsp` · `GET /conversations/:id/mcp` (MCP server status; mirrors `/lsp`) · `POST /chat/warm` · `POST /conversations/:id/close` (explicit
tab-close: abort turn + stop/disable warming) · `POST /conversations/:id/queue` (enqueue
steering message; auto-starts a turn if idle) · WS `chat.send`→`chat.delta` ·
WS `chat.subscribe`/`chat.unsubscribe` (watch a conversation's turns without sending; replay + live) ·
WS `chat.queue` (enqueue steering; fire-and-forget — surface updates on success) ·
WS `conversation.open` (broadcast: CLI `--open` flag signals the FE to open/focus a tab; carries `workspaceId`) ·
WS `conversation.statusChanged` (broadcast: lifecycle status change — `active`/`idle`/`closed`; carries `workspaceId`).

Mirrored in-repo for headless agents: `.dispatch/{ui-contract,wire,transport-contract}.reference.md`
(regenerate on any contract bump; all current as of `ui-contract@0.2.0` /
`transport-contract@0.22.0` / `wire@0.12.0`).

### FE invariants to keep (don't regress)

- **`chat.send` must omit `cwd`** (send `undefined`), never `cwd:""`/`cwd:null`. The `/chat` `cwd`
  field treats any non-`undefined` value as "provided". Verified safe: `chat/store.svelte.ts` builds
  `chat.send` with only `type`/`conversationId`/`message`/`model` — no `cwd` field.
- **Per-conversation seqs are 1-based, monotonic, gap-free** (CR-5 contractual guarantee on
  `StoredChunk`). The FE derives `hasOlder = oldestLoaded.seq > 1`.
- **Warming opt-in is NOT re-hydrated across a backend restart** — a conversation reads disabled
  until toggled again (fail-safe). Backend offered boot hydration if it becomes a product need.
- **`PUT /conversations/:id/cwd` sends the active `workspaceId`** (CR-8) so a relative cwd set on a
  new/draft tab is assigned to the workspace BEFORE persisting — the subsequent `GET /lsp` then
  resolves it against `workspace.defaultCwd`. The store reads `activeWorkspaceId` with `untrack` at
  call time (never reactive inside the async). `chat.send` still omits `cwd` (the persisted cwd wins).
- **`conversation.open` and `conversation.statusChanged` WS broadcasts carry `workspaceId`** so tabs opened
  by the CLI `--open` flag (or by a cross-device `active` status change) are stamped with the conversation's
  actual workspace instead of the viewer's current workspace. The FE ignores any broadcast missing `workspaceId`
  (parser returns null) — acceptable because the backend contract is updated in lockstep.

---

## 2. Open asks FOR THE BACKEND

### CR-9 — `system:os` variable: include WSL detection + Linux distro → **OPEN**

The `system:os` system-prompt variable (resolved by the backend at construction time) should
return a richer OS string:

1. **WSL detection** — when running under Windows Subsystem for Linux, the resolved `system:os`
   value should indicate WSL (e.g. `"Linux (WSL)"` or `"WSL2"` rather than just `"Linux"`).
   Detection: check for the presence of `/proc/sys/fs/binfmt_misc/WSLInterop` or
   `Microsoft` in `/proc/version`, or the `WSL_DISTRO_NAME` environment variable.
2. **Linux distro** — on Linux, include the distribution name (e.g. `"Ubuntu 22.04"` or
   `"Ubuntu"` rather than just `"Linux"`). Source: `/etc/os-release` (`PRETTY_NAME` or
   `NAME`/`VERSION_ID`).

No wire/transport-contract/ui-contract change needed — this is a backend behavior change in
how the `system:os` variable is resolved (the type shape is unchanged: it's still a `string`).
The FE is unaffected (it only inserts `[system:os]` into the template; the backend resolves it).

### CR-7 — Workspace cwd fallthrough bug + relative-path resolution → **RESOLVED ✅ (backend shipped; FE code unchanged)**

Fixed backend-side (reply from arch-rewrite agent ab13). **No wire/transport-contract/ui-contract
bumps needed; FE does NOT need a re-pin or re-mirror.**

**What was fixed:**
1. Workspace `defaultCwd` now applies when the conversation has no explicit per-conversation cwd.
2. A per-turn `cwd` (or persisted `cwd`) that is **relative** is now resolved against the workspace
   `defaultCwd`, not raw → falls through to `process.cwd()`.
3. `DELETE /conversations/:id/cwd` now actually clears the persisted cwd (was a no-op stub).
4. New-conversation timing: first turn assigns the workspace before resolving cwd, so a relative
   per-turn cwd on a brand-new conversation resolves against the correct workspace.

**Resolution algorithm (backend-owned):**
```
workspaceCwd    = workspace?.defaultCwd ?? null
conversationCwd = persisted per-conversation cwd OR per-turn cwd from chat.send (null if omitted)
if (conversationCwd == null)        effectiveCwd = workspaceCwd ?? serverDefaultCwd  // process.cwd()
else if (conversationCwd[0] === "/") effectiveCwd = conversationCwd
else                                 effectiveCwd = path.resolve(workspaceCwd ?? serverDefaultCwd, conversationCwd)
```

**FE impact:** none — the FE already sends `workspaceId` and **omits `cwd`** on `chat.send`
(`src/features/chat/store.svelte.ts`). The persisted cwd is set separately via `PUT /conversations/:id/cwd`,
and the backend resolves it at turn start. `GET /conversations/:id/cwd` still returns the raw explicit
value (e.g., `"gameplay"`) for the CwdField; `GET /conversations/:id/lsp` returns the resolved effective
cwd.

**Optional future FE enhancement:** Add a "Clear" button to CwdField that calls
`DELETE /conversations/:id/cwd`, letting the user reset a conversation to inherit the workspace
`defaultCwd`. Not required for the fix.

---

### CR-10 — `workspaceId` on `conversation.open` / `conversation.statusChanged` WS broadcasts → **RESOLVED ✅ (`transport-contract@0.19.0`; FE consumed)**

**Bug:** When summoning an agent via the CLI `--open --workspace <id>` flag, the tab opened across
ALL workspaces instead of just the one it was assigned to. The backend knew the conversation's
workspace but dropped it from the broadcast — the `ConversationOpenMessage` and
`ConversationStatusChangedMessage` WS messages carried only `conversationId`. The FE then fell back
to stamping the tab with `activeWorkspaceId` (the viewer's current workspace), so the tab appeared in
every open browser tab's workspace view.

**Backend fix (shipped):** Additive `workspaceId: string` on both broadcast messages
(`transport-contract@0.19.0`). The backend resolves the conversation's persisted workspace
(`"default"` fallback) at broadcast time — not the per-turn start option — and includes it in the
`conversation.open` and `conversation.statusChanged` fan-out.

**FE fix (consumed):**
- WS parser (`src/adapters/ws/logic.ts`): parse + require `workspaceId` on both message types.
- `openConversation()` (`src/app/store.svelte.ts`): signature changed to
  `(conversationId, workspaceId)`; the tab is stamped with the message's `workspaceId`, not
  `activeWorkspaceId`. The `onConversationOpen` and `onConversationStatusChanged` handlers pass
  `msg.workspaceId` through.
- Re-mirrored `.dispatch/transport-contract.reference.md`.
- Tests updated: `logic.test.ts`, `index.test.ts`, `conformance.test.ts`.

**Note:** The FE parser now rejects `conversation.open` / `conversation.statusChanged` messages
missing `workspaceId` (returns null). This is acceptable because the backend contract is updated in
lockstep; a mixed-version setup (old backend + new FE) would silently drop those broadcasts.

---

### CR-11 — Per-conversation model persistence → **RESOLVED ✅ (`transport-contract@0.20.0`; FE consumed)**

**Backend (shipped):**
- `transport-contract@0.20.0` adds `ModelResponse` and `SetModelRequest`.
- New endpoints:
  - `GET /conversations/:id/model` returns `{ conversationId, model: string | null }`.
  - `PUT /conversations/:id/model` with body `{ model: string | null }` persists or clears the
    per-conversation sticky model selection.
- The backend resolves the model per turn: explicit `ChatRequest.model` override wins, else persisted
  model for the conversation, else the server default.

**FE (consumed):**
- Imported `ModelResponse` + `SetModelRequest`; re-mirrored `.dispatch/transport-contract.reference.md`.
- Added `refreshModel()` (`src/app/store.svelte.ts`) — fetches via `GET /conversations/:id/model` on every
  focus change (tab switch, workspace switch, boot, reconnect) and updates `activeModel`, the active tab's
  stored model, and the active chat store's model when a non-null model is returned.
- Updated `selectModel(model)` to persist the choice via `PUT /conversations/:id/model` when a real
  conversation tab is active; drafts still only update session-local state.
- Tests added (`src/app/store.test.ts`): model selection triggers a `PUT /model` with the right body,
  and a persisted model is recalled when focusing a new conversation.

---

### Workspaces — backend-owned conversation grouping with a default cwd → **RESOLVED ✅ (backend shipped; FE build in progress)**

A **workspace** is a URL-driven (`/<id>`) grouping of conversations that owns a default cwd (used by its
conversations that haven't set their own). Backend-owned so cross-device just works. The backend shipped
the finalized contract (`wire@0.12.0`/`transport-contract@0.16.0`): `Workspace`/`WorkspaceEntry` types,
`workspaceId` on `ConversationMeta` + `ChatRequest`/`QueueRequest`/`ChatQueueMessage`, workspace endpoints
(`GET /workspaces`, `PUT`/`GET /workspaces/:id`, `PUT .../title`, `PUT .../default-cwd`,
`DELETE /workspaces/:id`), `?workspaceId=` on `GET /conversations`, and `DELETE /conversations/:id/cwd`
(clear-to-inherit). Q1–Q8 decisions + full shapes in `backend-handoff-workspaces-reply.md`. FE re-pinned +
re-mirrored; FE feature build in progress.

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
| CR-12 | `GET /conversations/:id/mcp` MCP server-status endpoint (mirrors `/lsp`) | ✅ `transport-contract@0.22.0`; backend shipped; FE consumed + verified (3 LSP-shape diffs handled) |
| CR-10 | `workspaceId` on `conversation.open` / `conversation.statusChanged` WS broadcasts | ✅ `transport-contract@0.19.0`; FE consumed |
| CR-7 | Workspace cwd fallthrough bug + relative-path resolution | ✅ resolved (backend-only) |
| CR-1 | Loaded Extensions as a true table (`rendererId: "table"`) | ✅ shipped + consumed |
| CR-2 | catalog `scope` flag (`"global"` / `"conversation"`) | ✅ `ui-contract@0.2.0` |
| CR-3 | `user-message` event (watcher sees user prompt mid-turn) | ✅ `wire@0.6.0` |
| CR-4 | cache-warming lifecycle (default OFF, future `nextWarmAt`, `POST /close`) | ✅ `transport-contract@0.9.0` |
| CR-5 | history windowing (`?limit=`, `?beforeSeq=`, 1-based gap-free seqs) | ✅ `wire@0.6.1` / `transport-contract@0.10.0` |
| CR-6 | Assign seq during generation (incremental persist at step boundaries) | ✅ shipped; FE adoption pending |

---

## 2b. MCP server status slice → **RESOLVED ✅ (backend shipped CR-12; FE verified)**

Consumes the backend's `GET /conversations/:id/mcp` endpoint, mirroring `GET /conversations/:id/lsp`
exactly. Contract types in `transport-contract@0.22.0`: `McpServerState`
(`"connecting" | "connected" | "error" | "disconnected"`), `McpServerInfo`
(`{ id, state, error?, toolCount, configSource? }`), `McpStatusResponse`
(`{ conversationId, cwd: string|null, servers: McpServerInfo[] }`). Full backend handoff:
`../dispatch-backend/frontend-mcp-status-handoff.md`; shape/behavior details:
`../dispatch-backend/reports/transport-http-mcp.md`.

**Backend (shipped CR-12):** endpoint behaves identically to `/lsp` — no persisted cwd →
`{ cwd: null, servers: [] }` (HTTP 200, empty); MCP extension not loaded →
`503 { error: "MCP service not available" }`. The FE handles both gracefully (empty/no-cwd/503 paths
never crash the renderer; the 503 `error` string surfaces in red).

**FE (DONE + verified against the 3 LSP-shape differences the backend flagged):**
- Re-pinned `transport-contract` 0.20.0 → 0.22.0; re-mirrored `.dispatch/transport-contract.reference.md`
  (added the MCP section + the previously-missing `configSource` on `LspServerInfo`).
- New feature library `src/features/mcp/`: pure `logic/view-model.ts` (`viewMcpServer`/`viewMcpServers`/
  `summarizeMcpServers`, state→badge/label/busy mapping), `ui/McpStatusView.svelte` (mirrors
  `LspStatusView`'s structure — refresh button, loading, summary, server list), `index.ts`
  (`McpStatusView`/`manifest`/types). 9 view-model tests green.
- `AppStore.mcpStatus()` (`src/app/store.svelte.ts`) — mirrors `lspStatus()`: normalizes the untyped
  body at the network seam (`servers` guaranteed an array), returns `McpResult | null`.
- Wired into `src/app/App.svelte`: `"mcp"` view kind, `loadMcpStatus` adapter, `McpStatusView` in the
  `viewContent` snippet (re-mounts per conversation via `{#key store.currentConversationId}`).

**Three shape differences from LSP — verified handled, do NOT regress:**
1. **Fields differ.** `McpServerInfo` has only `{ id, state, error?, toolCount, configSource? }` — NO
   `name`/`root`/`extensions`. The MCP row markup (`McpStatusView.svelte`) renders `id`/state badge/
   `toolCount`/`error`/`configSource` only; it does NOT reference any LSP-only field. `McpServerView`
   is a distinct type from `LspServerView` (the latter carries `name`/`root`/`extensionsLabel`). Do not
   reuse the LSP row component verbatim for MCP.
2. **Enum differs.** `McpServerState = "connecting" | "connected" | "error" | "disconnected"` — a
   DIFFERENT enum from LSP's `"connected" | "starting" | "error" | "not-started"`. `viewMcpServer`'s
   switch handles all four MCP cases (exhaustive vs the contract): `connected`→success, `connecting`→
   warning+busy(spinner), `disconnected`→neutral (NOT busy — a stable idle state), `error`→error. Do
   not share the LSP badge mapping.
3. **`configSource?` is currently always absent** on this path (the `McpServerStatus` source doesn't
   carry it) but the wire type leaves it optional. The FE renders it defensively: view-model coerces
   `server.configSource ?? null`; the template guards `{#if server.configSource}` with an empty-`<span>`
   fallback, so absence renders nothing. Verified correct for the current always-absent reality.

**Live probe:** NOT run — the backend was not reachable on `:24203` at verify time (the backend is the
user's process; never booted headless). The unit suite (775 tests, incl. 9 mcp) is green; a live probe
against a running backend remains a nice-to-have for the actual network seam (it's a plain HTTP GET,
no WS). Start the backend and run `bun scripts/live-probe.ts` (or just open the MCP Servers sidebar view)
to confirm end-to-end.

---

## 2c. Transient `provider-retry` AgentEvent → **CONSUMED ✅ (backend shipped; FE wired + tested)**

The backend now retries retryable provider errors (e.g. "server overloaded" HTTP 429/5xx) with a stepped
backoff (5s→10s→30s→60s→5m→10m→15m→30m→repeat, up to an 8h budget). Each scheduled retry emits a NEW
**transient** `AgentEvent`: `provider-retry`. The FE renders it as a **yellow warning system-message
bubble**; the actual model reply still streams normally after a retry succeeds. Contract types are in
`wire@0.12.0` (additive — the type was added to the existing version, no bump; the FE's `file:` dep picks
it up automatically, no re-pin needed). `TurnProviderRetryEvent`:
`{ type: "provider-retry", conversationId, turnId, attempt (0-based), delayMs, message, code? }`.

**FE (DONE + verified):**
- Re-mirrored `.dispatch/wire.reference.md` (added `TurnProviderRetryEvent` to the `AgentEvent` union +
  its interface). The FE already resolved the new type via the `file:` symlink (no re-pin).
- `src/core/chunks/types.ts`: added `providerRetry: TurnProviderRetryEvent | null` to `TranscriptState`
  (mirrors the `generating` UI-indicator pattern — event-stream-derived state that is NOT a chunk).
- `src/core/chunks/reducer.ts`: `foldEvent` SETS the banner on a `provider-retry` (coalescing — latest
  attempt+delay replaces previous → a single updating banner) and CLEARS it when content resumes
  (`text-delta`/`reasoning-delta`/`tool-call`/`tool-result`), the turn ends (`done`/`turn-sealed`/`error`),
  or a new turn starts (`turn-start`); metadata events (`status`/`usage`/`step-complete`/`tool-output`)
  leave it untouched. The clearing is centralized via a `RETRY_CLEARING_EVENTS` Set in a thin `foldEvent`
  wrapper over the renamed inner `reduceEvent`. `clearGenerating` (WS reconnect) also drops a stale banner.
- `src/core/wire/conformance.ts` + `.test.ts`: added the `provider-retry` case to the exhaustiveness guard
  and bumped the variant count 14 → 15 (the `satisfies never` guard is what flagged the new variant).
- `src/core/chunks/selectors.ts` (`selectProviderRetry`) + new `retry-banner.ts` view-model
  (`viewProviderRetry` → `{ attemptLabel: "Retry #N", delayLabel: "5s"/"30m", message, code }`,
  `formatRetryDelay`), exported from `chunks/index.ts` + re-exported from `features/chat/index.ts`.
- `src/features/chat/store.svelte.ts`: `providerRetry` getter + `ChatStore` interface field (mirrors
  `generating`).
- `src/features/chat/ui/ChatView.svelte`: new `providerRetry` prop → renders a DaisyUI `alert alert-warning`
  yellow bubble at the end of the transcript (where the reply would appear), with `⚠ Retry #N — retrying in
  {delay}…`, a `code` badge, and the endpoint error verbatim. Re-mounted per conversation.
- `src/app/App.svelte`: passes `providerRetry={store.activeChat.providerRetry}`.
- 19 new tests (reducer: set/coalesce/clear-on-resume/clear-on-turn-end/clear-on-new-turn/clear-on-reconnect/
  not-a-chunk/metadata-preserves; retry-banner: delay formatting + view-model). 775 tests green.

**Transient / never-persisted guarantee (the critical invariant):** `provider-retry` is NEVER a `Chunk`
(it's not in the `Chunk.type` union — `assertChunkExhaustive` is unchanged). It lives only in
`TranscriptState.providerRetry`, set/cleared by `foldEvent`. It never enters `committed` (seq'd history) or
`provisional`, so it can NEVER pollute the model's prompt or be sent back as a message. On a reload/replay of
past turns it is NOT replayed (only committed seq'd chunks are history) — `providerRetry` starts null and is
set only when a NEW `provider-retry` arrives. On a WS reconnect mid-turn, `clearGenerating` drops any stale
banner (past retries aren't replayed). If the 8h budget exhausts, the existing terminal `error` `AgentEvent`
fires and seals the turn — rendered as the existing error state (the banner is cleared by the `error` case).

**Note on `step-complete` timing:** when retries occur, the `step-complete` event's `genTotalMs` includes
the retry-sleep time (backend-side, cosmetic). The FE surfaces per-step timing unchanged — no action needed.

**Open follow-up (optional, not blocking):** the "countdown" is a STATIC label derived from `delayMs`
("retrying in 5s…"), matching the backend's examples — NOT a live ticking timer (which would be a component
effect + re-render churn). A live ticking countdown (5,4,3,2,1…) could be added later as a Svelte
`$effect`/`setInterval` in ChatView if desired, but the static label is accurate and keeps the component thin.

**Live probe (run, backend up):** `scripts/live-probe-provider-retry.ts` — 8/8 checks passed:
- REGRESSION: a real text turn through the REAL WS socket + the updated `foldEvent` sealed cleanly and
  `providerRetry` stayed NULL throughout (no spurious banner; the `reduceEvent` wrapper didn't break streaming).
  (The repo-wide `scripts/live-probe.ts` also still passes 23/23 — text/tool/metrics/CR-5 all green with the
  updated reducer.)
- PARSER+REDUCER SEAM: a synthetic `provider-retry` `chat.delta` JSON frame through the REAL
  `parseServerMessage` is ACCEPTED (not rejected as unknown) → `foldEvent` SETS `providerRetry` (attempt/
  delayMs/code correct) and adds NO chunk → a 2nd coalesces → a subsequent `text-delta` CLEARS it and the
  reply lands as a chunk. This is the JSON-parse boundary the unit tests skip (they pass constructed events).
- NOT exercised live: the actual banner rendering in the browser (a real `provider-retry` from an overloaded
  provider can't be forced from a probe — it needs a human at the page with a 429'ing provider). The full
  data path (wire parse → reducer → state) IS verified live; only the Svelte render of the yellow bubble
  remains a human-confirm (open the chat, trigger an overloaded provider, confirm the yellow "⚠ Retry #N —
  retrying in 5s…" banner appears, updates per attempt, and clears when the reply streams).

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
