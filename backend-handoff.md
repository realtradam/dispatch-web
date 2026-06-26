# Backend handoff — LIVING doc (FE ⇄ backend, couriered by the user)

> **Purpose:** the single rolling document the FE orchestrator keeps current so the user can hand off
> the whole FE↔backend seam at any time — on completion OR at a roadblock. Updated continuously.
> **From:** dispatch-web orchestrator · **To:** `../dispatch-backend` orchestrator · **Courier:** the user.
> `lsp` does NOT span the repos (AGENTS.md § Backend seam) — every cross-repo ask flows through here.

_Last updated: 2026-06-26 (§2g ADDED — Heartbeat follow-up UI: prompt editor modal (reuses `GET /system-prompt/variables`;
opens 1 backend ask CR-HB-1: confirm/implement `[type:name]` variable resolution in the heartbeat system/task prompts)
+ hours/minutes interval timer (FE-only conversion, no backend change). typecheck 0/0, tests green, biome clean, build OK).
§2f (the initial heartbeat slice) is unchanged._
**FE is current on `ui-contract@0.2.0` / `transport-contract@0.22.0` / `wire@0.12.0`.** Open asks: **CR-9**
(`system:os` should detect WSL + include Linux distro — backend behavior change, no contract bump). The SSH-divergence
(§2d) is RESOLVED.
Backend shipped CR-10 (workspace id on `conversation.open` / `conversation.statusChanged`), CR-11
(per-conversation model persistence), and CR-12 (`GET /conversations/:id/mcp`); FE has consumed all three.
The backend also added the transient `provider-retry` `AgentEvent` (retry-with-backoff warning) to
`wire@0.12.0` on `dev` (additive — no version bump); FE consumed + re-mirrored `.dispatch/wire.reference.md` — see §2c.
FE re-pinned + re-mirrored `transport-contract`; `selectModel` persists to
`PUT /conversations/:id/model` and conversation focus recalls the persisted model via `GET /conversations/:id/model`.
FE consumes the MCP status slice (`GET /conversations/:id/mcp`, mirroring `/lsp`) — see §2b.

---

## 1. Pinned backend contracts (consumed by the FE)

Pinned as `file:` deps: **`ui-contract@0.2.0`; `wire@0.12.0`; `transport-contract@0.22.0`**.

| Package | Used for |
|---|---|
| `@dispatch/ui-contract` | surfaces + surface WS protocol |
| `@dispatch/wire` | `Chunk`/`StoredChunk`(+`seq`)/`ChatMessage`/`AgentEvent`/`TurnSealedEvent`/`TurnProviderRetryEvent`(transient retry-warning)/`Usage`/`StepId` + metrics: `StepMetrics`/`TurnMetrics`, `usage.stepId`, `step-complete`, `done.durationMs`/`done.usage`, `tool-result.durationMs`, `done.contextSize`/`TurnMetrics.contextSize`, `ReasoningEffort`, `QueuedMessage`/`QueuePayload`/`TurnSteeringEvent`, `ConversationMeta`/`ConversationStatus`, `Workspace`/`WorkspaceEntry`(+`defaultComputerId`)/`Computer`/`ComputerEntry` (SSH handoff #1) |
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

## 2d. SSH support — handoff #1 (wire types) → **CONSUMED ✅ (provider-retry divergence RESOLVED)**

The first of a few incremental SSH handoffs. The backend's `@dispatch/wire` (pinned `file:` dep) gained SSH-computer
types — **additive to `wire@0.12.0`, NO version bump** (same pattern as `provider-retry`). The full HTTP API surface
(computer endpoints, `chat.send computerId`) comes in a LATER handoff; this one is wire-types only.

**New wire types (consumed + re-mirrored):**
- `Workspace` gained a REQUIRED `defaultComputerId: string | null` (null = local / no SSH; the computer analog of
  `defaultCwd`). Resolution is SERVER-owned (per-conv `computerId` → `workspace.defaultComputerId` → `null`/local).
- `Computer` — a read-only view of a discovered `~/.ssh/config` `Host` target:
  `{ alias, hostName, port, user, identityFile, knownHost }`. `alias` IS the `computerId` users select. NOT an
  editable entity (no CRUD store — the user edits `~/.ssh/config` to add one).
- `ComputerEntry extends Computer` — adds `usageCount` (for `GET /computers`).

**FE (DONE):**
- Re-synced the `@dispatch/wire` `file:` dep (worktree layout note below) so the new types resolve.
- Re-mirrored `.dispatch/wire.reference.md`: added `Workspace.defaultComputerId`, the `Computer`/`ComputerEntry`
  section, and a header delta note.
- Fixed the 2 `Workspace`/`WorkspaceEntry` test literals that broke (the handoff's expected break):
  `src/features/workspaces/ui/WorkspaceCard.test.ts` (`fakeEntry`) and
  `src/features/workspaces/logic/view-model.test.ts` (`ws` factory) — both now supply `defaultComputerId: null`.
  (The conformance test's `provider-retry` case is the unrelated divergence below — NOT a `defaultComputerId` site.)
- Added `computer` / `computerId` to `GLOSSARY.md` (backend-canonical, adopted verbatim).

**NOT started (correctly deferred):** the `computer` feature folder, the per-conversation + workspace-default
selectors, the connection-status badge, and `chat.send computerId` — all wait on the later HTTP-API handoff.

### `provider-retry` divergence → **RESOLVED ✅ (backend merge `de022ce`)**

**Was:** the backend `feature/ssh-support` branch (cut from `8a74335`) was MISSING `TurnProviderRetryEvent` /
`provider-retry` (on `dev`), causing 11 FE typecheck errors. **Resolved:** backend merged `dev` into
`feature/ssh-support` (merge commit `de022ce`, in the shared `../backend` worktree); `packages/wire/dist/index.d.ts`
now exports `TurnProviderRetryEvent` (AgentEvent union line 231 + interface line 384) ALONGSIDE the SSH types
(`Workspace.defaultComputerId`, `Computer`). Backend post-merge: `tsc -b` EXIT 0, biome clean, 1730 vitest pass.
The auto-merge was clean — `computerId` threading + retry-with-backoff coexist.

**FE (DONE, zero code changes):** re-synced both `file:` deps (`bun install`); `node_modules/@dispatch/wire` +
`@dispatch/transport-contract` both resolve `TurnProviderRetryEvent` (the transport-contract re-export confirmed).
`bun run typecheck` is now **GREEN — 0 errors, 0 warnings** (the 11 cleared with NO FE code changes; the
`provider-retry` consumption was already complete + tested). Full suite: 795/795 tests, biome clean, build OK.

### Worktree environment note (not a contract change)
This worktree lays the repos out as `…/worktrees/ssh-support/{backend,frontend}`, but `package.json`'s canonical
`file:` paths point at `../dispatch-backend` (correct for the main `dispatch/{dispatch-backend,dispatch-web}` layout).
To keep `package.json` canonical (no worktree-specific hack committed), a symlink `../dispatch-backend → ../backend`
was created in the worktree parent (untracked, outside the repo), then `bun install` re-synced `node_modules/@dispatch/*`.
The backend wire `dist/` was already built + current (has the new types); no backend edit was made.

---

## 2e. SSH support — handoff #2 (full computer HTTP API) → **CONSUMED ✅ (FE built; fully green post §2d merge)**

The backend shipped the full SSH computer HTTP/WS API (transport-contract types stable; the `ssh` extension that
provides the ComputerService is the last backend wave — until it lands, `GET /computers` returns `[]` and statuses
return `disconnected`, which the FE renders gracefully). The FE mirrors the existing `cwd`/`workspaces` UI.

**New transport-contract types consumed (additive to `transport-contract@0.22.0`, NO version bump):** `ComputerListResponse`
(`GET /computers`), `ComputerResponse`, `ComputerStatusResponse` (`GET /computers/:alias/status`), `TestComputerResponse`
(`POST /computers/:alias/test`), `SetConversationComputerRequest` + `ConversationComputerResponse`
(`GET`/`PUT`/`DELETE /conversations/:id/computer`), `SetWorkspaceDefaultComputerRequest`
(`PUT /workspaces/:id/default-computer`), and `computerId?: string` on `ChatRequest`/`ChatSendMessage`/`QueueRequest`.
`Computer`/`ComputerEntry` are `@dispatch/wire` (handoff #1). Re-mirrored `.dispatch/transport-contract.reference.md`
(added the Computers section + `ChatRequest.computerId`).

**FE (DONE — mirrors cwd-lsp's consumer-defines-port pattern):**
- New feature library `src/features/computer/`: pure `logic/view-model.ts` (`viewComputer`/`viewComputerStatus`/
  `viewTestResult`/`summarizeComputers`/`formatHost`/`knownHostLabel` + state→badge mapping for the 4
  `ComputerStatusResponse.state`s + the `SaveComputer`/`LoadComputerStatus`/`TestComputer`/`LoadComputers` ports) — 20
  view-model tests green; `ui/ComputerField.svelte` (per-conversation selector: dropdown + connection-status badge +
  Test-connection, polling the selected alias) + `ui/ComputerSelect.svelte` (a reusable Local/computers dropdown, shared
  with the workspace default-computer control); `index.ts` (`ComputerField`/`ComputerSelect`/`manifest`/types).
- `AppStore` (`src/app/store.svelte.ts`): `computerId` reactive state + `refreshComputer()` (parallel to `refreshCwd`,
  called at every focus site: boot, workspace switch, draft→tab, newDraft, selectTab, removeTabLocally) +
  `setComputer(computerId: string | null)` (`PUT /conversations/:id/computer`, null = clear) + a global `computers`
  catalog (`GET /computers` on boot, like `models`) + `computerStatus(alias)` + `testComputer(alias)`. New result types
  `ComputerResult`/`ComputerStatusResult`/`TestComputerResult`. `chat.send` UNCHANGED (computer resolved server-side
  from the persisted per-conversation value, exactly like cwd).
- `src/app/App.svelte`: `ComputerField` mounted in the "Model" sidebar view next to `CwdField`, keyed on
  `currentConversationId`; adapted ports (`saveComputer`/`loadComputerStatus`/`testComputer`) wrap the store.
- Workspaces: `setDefaultComputer` added to `WorkspaceHttp` + `WorkspaceStore` (`PUT /workspaces/:id/default-computer`);
  a default-computer selector (reusing `ComputerSelect`) added to `WorkspaceCard.svelte` next to the default-cwd control;
  the router (`src/App.svelte`) passes `store.computers` through `WorkspacesHome` → `WorkspaceCard`.

**Transparency invariant (held):** the computer is USER-facing only — it is a tool-execution target forwarded to tools
and NEVER part of the model prompt (so it does not affect prompt caching); the agent never sees it. Documented in the
feature's pure core + surfaced in the `ComputerField` helper text.

**NOT done (correctly deferred):** a per-send `computerId` override (the MVP UI doesn't expose it; persisted per-conversation
suffices). No `chat.send` change.

**Verification:** 795/795 tests green (50 files; +20 computer view-model); biome clean; `vite build` succeeds. `svelte-check`
reports **0 errors from the computer feature**. (The pre-existing §2d `provider-retry` divergence — 11 errors — is
now RESOLVED via the backend `dev`→`feature/ssh-support` merge `de022ce`; `bun run typecheck` is fully GREEN.)
Live probe NOT run (the backend `ssh` extension isn't live yet → `GET /computers` returns `[]` end-to-end; a live probe +
human confirm of the dropdown/badge/test should run once `ssh` is wired + the `provider-retry` divergence is merged).

---

## 2f. Heartbeat (workspace autonomous-agent loop) → **CONSUMED ✅ (backend shipped; FE built)**

The backend shipped a workspace-scoped **heartbeat** — an autonomous agent loop that periodically runs a turn in a
dedicated conversation using a configured system prompt, task prompt, model, reasoning effort, and interval. The FE
exposes the config, run history, and a per-run live chat in a new sidebar **Heartbeat** view (branch `feature/heartbeat`).

**Backend API (plain REST — NOT a transport-contract type):**
- `GET /workspaces/:id/heartbeat` → `{ enabled, systemPrompt, taskPrompt, intervalMinutes, model, reasoningEffort }`
- `PUT /workspaces/:id/heartbeat` (partial body) → updated config
- `GET /workspaces/:id/heartbeat/runs` → `{ runs: [{ id, conversationId, triggeredAt, status }] }` (`status: running|completed|stopped`)
- `POST /workspaces/:id/heartbeat/runs/:runId/stop` → `{ ok: true }`

**Contract note (important):** the heartbeat shapes are NOT in `@dispatch/transport-contract` / `@dispatch/wire`
(verified: no `heartbeat` symbol in either `dist/`). So the FE owns the types locally in `src/features/heartbeat/logic/types.ts`
(consumer-defines-port, mirroring the `mcp`/`computer` result-type pattern) and coerces the untyped JSON at the network
seam via pure `normalizeHeartbeatConfig`/`normalizeHeartbeatRuns` (a malformed/partial response can never crash the
renderer). **If the backend later promotes these to a shared contract package, swap the local types for the imports +
re-mirror `.dispatch/*.reference.md`.** No contract version bump on the FE side (no `file:` dep re-pin needed).

**FE (DONE + verified):**
- New feature library `src/features/heartbeat/`: pure `logic/view-model.ts` (`viewRun`/`viewRuns`/`badgeForStatus`/
  `statusLabelFor`/`formatRunTime`/`relativeLabel`/config-form helpers `formFromConfig`/`patchFromForm`/`formDiffers`/
  `normalizeInterval` (1–1440 clamp)/network normalizers + `effortOptions` re-exported from `features/chat`) — 35
  view-model tests green; `ui/HeartbeatView.svelte` (config panel: enable toggle (saves immediately), system + task
  prompt textareas, model dropdown, reasoning-effort dropdown, interval input, Save button with `hasChanges` guard;
  scrolling runs list polling every 4s with a spinner when running + per-row Stop) + `ui/RunModal.svelte` (fullscreen
  modal that reuses `features/chat`'s `ChatView` to render the run's conversation; live-streams via the store's
  `watchConversation`/`chat.subscribe` while `generating`, with a Stop button → `POST .../runs/:runId/stop`);
  `index.ts` (`HeartbeatView`/`RunModal`/`manifest`/types). The reasoning-effort ladder is REUSED from `features/chat`
  (sanctioned cross-feature import through its public exports) — no drift.
- `AppStore` (`src/app/store.svelte.ts`): `heartbeatConfig`/`setHeartbeatConfig`/`heartbeatRuns`/`stopHeartbeatRun`
  (workspace-scoped; read `activeWorkspaceId` with `untrack`) + **`watchConversation`/`unwatchConversation`** — a new
  "watch" mechanism for the modal: reuses an open tab's `ChatStore` (already subscribed) or creates an EPHEMERAL watch
  store in a new `watchStores` map (separate from tabs — never opens a tab) + subscribes via `chat.subscribe` + loads
  history; deltas route to it (the `handleChatMessage` hot path now also checks `watchStores`); `onReopen` re-subscribes
  + resyncs watch stores; `dispose` disposes them. `unwatchConversation` is a no-op for a tab conversation (it keeps its
  store + stream) — only the ephemeral watch store is disposed + unsubscribed.
- Wired into `src/app/App.svelte`: `"heartbeat"` view kind (in `viewKinds`), `heartbeatManifest` in `loadedModules`,
  thin adapter functions, the `viewContent` snippet branch, + `{#key heartbeatRun.id}` RunModal render when a run is
  selected.
- Store tests (`src/app/store.test.ts`): +7 — config load/PUT-merge/error, runs load, stop POST, watch subscribe +
  live-delta routing, tab-reuse (no extra subscribe) + unwatch no-op for a tab.
- Also fixed a PRE-EXISTING `WorkspaceCard.test.ts` typo (`onNavigate` shorthand used before declaration →
  `onNavigate: vi.fn()`) that was red on the branch HEAD independent of heartbeat.

**Verification:** 837/837 tests green (run TWICE — no cross-test pollution; the watch stores are plain `Map`s, not
shared globals, but the methodology's double-run is honored); `svelte-check` 0 errors; biome clean; `vite build`
succeeds. Live probe NOT run (the backend's heartbeat loop + endpoints were not reachable headless at verify time; the
unit + store tests fully cover the data path + the WS routing seam). To confirm end-to-end: start the backend, open the
Heartbeat sidebar view, toggle enable, edit+Save the config, watch a run appear + stream live in the modal, click Stop.

**Vocabulary note (heads-up, not blocking):** `GLOSSARY.md` marks **"view"** as RESERVED (old-Dispatch sidebar
affordance, future). The heartbeat UI follows the codebase's ESTABLISHED convention — sidebar panels are already called
"views" pervasively (`viewKinds`, `ViewSidebar`, `viewContent`, "Model view"/"LSP view"/"Settings view"). The feature
module itself is named `heartbeat` (a feature module). No new term was coined. If the reserved-"view" cleanup happens
later, the heartbeat view kind renames in lockstep with the rest.

---

## 2g. Heartbeat follow-up UI — prompt editor modal + hours/minutes timer → **FE BUILT; 1 BACKEND ASK**

A follow-up to §2f (branch `feature/heartbeat`, uncommitted-to-this-handoff commit). Two UI changes on the heartbeat
config panel, each analyzed below for backend impact. **One needs a backend change (variable resolution in the
heartbeat prompts); the other needs none.**

### Change A — Prompt editor modal (replaces the two textareas) → **1 BACKEND ASK (CR-HB-1)**

The config panel's two inline textareas (system prompt + task prompt) are replaced by a single "Edit prompts" button
that opens a full-width modal (`src/features/heartbeat/ui/PromptEditor.svelte`):
- LEFT side: two stacked text editors (top = system prompt, bottom = task prompt).
- RIGHT side: the variable palette (grouped by type, same `[type:name]` tag insertion as the global system-prompt
  builder). Clicking a variable inserts `[type:name]` at the cursor of whichever textarea is focused.
- Save persists both prompts via the existing `PUT /workspaces/:id/heartbeat` with `{ systemPrompt, taskPrompt }`
  (a partial patch — no new endpoint, no data-shape change).

**What the FE reuses (NO new endpoint needed):**
- The variable palette is sourced from the EXISTING global `GET /system-prompt/variables` endpoint — the SAME one the
  global System Prompt builder uses. The heartbeat feature imports the pure helpers (`buildTag`, `groupVariables`,
  `insertTag`, `isDynamicVariable`) from `features/system-prompt` (its public `index.ts` — `isDynamicVariable` was added
  to that export in this slice, an additive cross-unit seam change). So there is **no new variable source or endpoint**;
  the heartbeat prompt editor offers the exact same variable tags the global system prompt does.
- The persisted strings carry literal `[type:name]` placeholders (plain text), exactly like the global template.

**CR-HB-1 — Resolve `[type:name]` variables in the heartbeat system/task prompts → ASK (needs backend confirmation + likely implementation):**

The global system-prompt template is resolved by the backend: `[type:name]` placeholders (e.g. `[system:os]`,
`[system:date]`, `[file:path]`, `[if system:wsl]…`) are substituted with their resolved values at construction time
(once per conversation at first turn, then persisted for prompt-cache safety). **The critical question: does the
backend apply this SAME variable resolution to the heartbeat's `systemPrompt` and `taskPrompt` fields?**

- If YES (the heartbeat prompts already flow through the same resolver as the global template): **no backend change
  needed** — the FE just inserts the same `[type:name]` tags and the backend resolves them. Confirm + close.
- If NO (the heartbeat prompts are inserted into the model turn as raw text, so `[system:os]` would reach the model
  literally as the string `[system:os]` rather than the resolved OS string): **the backend should resolve `[type:name]`
  placeholders in the heartbeat `systemPrompt` + `taskPrompt` using the SAME resolver/variable set as the global
  system prompt** (so a variable inserted in either place resolves identically). This is the expected gap — the heartbeat
  prompts are a NEW surface that predates the variable system, so they likely bypass the resolver.

  - Resolution timing: mirror the global template's behavior — resolve once when a heartbeat run's turn is constructed
    (NOT on every interval tick, to stay prompt-cache-safe; a stable resolved prompt keeps the cache warm across runs).
    If the heartbeat re-resolves per-run anyway (intervals may want fresh `[system:time]`), that's a backend product
    decision — the FE doesn't care WHEN it resolves, only THAT `[type:name]` becomes its value.
  - Variable set: the SAME catalog `GET /system-prompt/variables` returns (system/file/prompt/git groups). No
    heartbeat-specific variables are required for this slice.
  - No wire/transport-contract/ui-contract change needed — this is a backend behavior change (the prompt strings are
    still `string`; the FE is unaffected once the backend resolves them).

**Optional future enhancement (NOT required now):** heartbeat-specific variables (e.g. `[heartbeat:runCount]`,
`[heartbeat:lastResult]`, `[heartbeat:elapsed]`). The FE's prompt editor would offer these if `GET /system-prompt/variables`
(or a new `GET /workspaces/:id/heartbeat/variables`) returned them. Defer until there's a product need.

### Change B — Hours + minutes interval timer → **NO backend change needed**

The interval input is split into two fields: an HOURS input (left) + a MINUTES input (right, 0–59). The conversion is
entirely FE-side:
- On load: the backend's single `intervalMinutes` is split into `{ hours, minutes }` via the pure `splitInterval`
  helper (`Math.floor(total/60)` hours, remainder minutes).
- On save: the FE recombines via `joinInterval(hours, minutes)` → `hours*60 + minutes` (clamped to the 1–1440 range
  = 1 min–24 h) and sends a SINGLE `intervalMinutes` integer to `PUT /workspaces/:id/heartbeat`.

So **the backend's `intervalMinutes` field is UNCHANGED** — still one integer of total minutes. The hours/minutes split
is pure FE presentation. No endpoint, data-shape, or behavior change. (The existing clamp to 1–1440 also stands; a
0h0m entry clamps to 1 minute — the FE guards this, and the backend's own validation should too, but that's pre-existing.)

### FE summary (this slice)
- `src/features/heartbeat/logic/view-model.ts`: `HeartbeatFormState` now carries `intervalHours` + `intervalMinutes`
  (0–59); new pure `splitInterval`/`joinInterval` round-trip helpers; `formFromConfig`/`patchFromForm`/`formDiffers`
  updated to split/recombine. +4 tests (split/join round-trip, form split, differs-after-edit).
- `src/features/heartbeat/ui/PromptEditor.svelte` (new): two-pane modal (system+task editors left, variable palette
  right), focus-aware variable insertion, Save/Reset. Reuses `features/system-prompt`'s pure helpers.
- `src/features/heartbeat/ui/HeartbeatView.svelte`: two textareas → "Edit prompts" button + modal; interval → hours+minutes inputs.
- `src/features/system-prompt/index.ts`: added `isDynamicVariable` to the public exports (additive — needed by the
  heartbeat editor's dynamic `file:<path>` row).
- `src/app/App.svelte`: passes `loadVariables={loadSystemPromptVariablesPrompt}` to `HeartbeatView`.

**Verification:** typecheck 0/0, tests green, biome clean, build OK (see the commit). The variable-resolution behavior
(CR-HB-1) can only be confirmed end-to-end against a running backend with variable-laden heartbeat prompts — a human
should set `[system:os]` in a heartbeat prompt via the new editor, trigger a run, and confirm the resolved value (not the
literal `[system:os]`) appears in the model's context / run transcript.

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
