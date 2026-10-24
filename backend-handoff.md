# Backend handoff — Dispatch Web (tracked; kept current at every milestone)

> This living document is the cross-repo courier between the FE (this repo) and the BACKEND
> (`../backend`, a separate repo). `lsp` does not span the seam — the USER carries updates across.
> Per AGENTS.md "Backend seam": FE contract changes are edited + consumers updated here; BACKEND
> contract changes are REPORTED UP here, and on the new version the FE re-pins the `file:` dep,
> re-mirrors `.dispatch/*.reference.md`, and updates consumers. NEVER edit the backend repo.
>
> **NOTE (tiled-layout worktree, 2026-09-04):** plans 01–04 of the layout series are being
> implemented in BOTH repos of this worktree by one task (branch `feature/tiled-layout`), so the
> "never edit the backend repo" rule is superseded by that task's scope — the backend contract
> changes below were made in the same branch and the FE consumes them via the `file:` deps
> (dists rebuilt). Listed here for the record.
>
> **NOTE (archive-workspaces worktree, 2026-09-20):** the archive-workspaces feature was likewise
> implemented in BOTH repos of one worktree (branch `feature/archive-workspaces`), so the backend
> contract change (`Workspace.archived`, `PUT/DELETE /workspaces/:id/archive`, `GET /workspaces
> ?archived=`) was made in the same branch and the FE consumes it via the `file:` deps (dists
> rebuilt). Recorded below.

## Milestone: Consistent composer action width (`dev`, 2026-10-24)

- Send, Queue, Stop, and Flush now share the same fixed `w-20` width; Flush no longer
  widens the composer or changes text wrapping. Button actions and labels are unchanged.
- Added regression coverage for the shared width across all four labels.
- Verified: typecheck (0 errors/warnings), tests (2,591 passed; 2 skipped), Biome, and build.
- Backend contracts, pins, and mirrors unchanged; no backend work required.

## Milestone: Close-tab cascade subagents (`feature/close-tab-cascade-subagents`, 2026-10-24)

**Slice status: COMPLETE across the isolated frontend + backend feature branches.**

- Frontend integrated local `dev` at `913cc7b` (merge `b462f17`), preserving the new
  tab colors, 70vh grid, FLIP close/reflow animations and current reliability fixes.
- Closing a tab with a nonempty **visible tab-group** subtree prompts once:
  **Yes, close all N** closes the snapshotted transitive subtree; **No, keep them open**
  closes only the parent; Cancel/Escape/backdrop close nothing. Leaf tabs close directly.
  New tabs arriving after confirmation opens are not silently added to its close set.
  This is visual `tabGroupParentId` grouping, NOT backend lineage traversal or an implicit
  server cascade. Other workspaces and unopened conversations are outside this close set.
- Native modal dialog renders in the browser top layer (not clipped by animated/sidebar
  containers), traps keyboard focus, starts on Cancel, restores focus on dismissal, and
  wraps actions at mobile widths. Remote target closure/workspace switch dismisses stale UI.
- Each id uses the existing `AppStore.closeTab` → single `POST /conversations/:id/close`
  route; real-store component regressions cover persistence + workspace isolation for
  all/parent/cancel. No double-close workaround or new FE cross-unit port.

**Backend race discovered and FIXED, not waived:** explicit Close aborted the turn, but
its finalization unconditionally persisted/published `idle` afterward, reopening the tab.
The original companion symlink to main was replaced (with user authorization) by a real
backend `feature/close-tab-cascade-subagents` worktree at local `dev` `4bf4dd9`.
Commit **`fd07259`** preserves Close through deferred lifecycle work and settlement,
keeps Stop → idle + explicit reopen behavior, suppresses stale broadcasts/auto-compaction,
and cleans per-turn lifecycle tracking. Five real-store regressions cover the race.
See backend `notes/close-tab-cascade-subagents.md` for reproducible direct HTTP steps.
Neither main checkout nor the user's running backend process was edited/restarted.

**Contract pins/mirrors:** unchanged `file:../backend/packages/*` deps; `wire@0.12.0`,
`transport-contract@0.26.0`, `ui-contract@0.2.0` (existing additive mirrors retained).
Dependencies were refreshed after replacing the companion with its real worktree.
No API/type/version delta to mirror; no remaining backend asks.

**Verification:**
- FE: `bun run typecheck` **0 errors/0 warnings**; full suite **2,516 passed ×2**
  (127 files; an earlier pass before the final focus regression was 2,515);
  `bun run check` clean; `bun run build` succeeds (existing Svelte capture/chunk-size warnings).
- BE: typecheck clean; Vitest **4,214 passed / 10 skipped**; Biome clean;
  Bun suite final combined run **188 passed**, also all seven groups pass independently.
  Two earlier combined Bun runs hit native Bun 1.3.14 crashes; subsequent combined run passed.
- Writable live verification used ONLY a private source backend at **24303/24305**, with
  fresh SQLite/trace/journal/image/plugin paths under `/tmp/close-tab-isolated` and
  inherited real credentials (never printed or replaced). Standard live probe **22/22**.
- Direct HTTP active-turn close now returns `abortedTurn: true`, seals/ends aborted and
  stays absent from active/idle list after stream completion. Real Chromium end-to-end
  cascade does the same for the nested active child, leaves unrelated tabs and stays
  closed after reload. Desktop 1280px + mobile 420px checks pass: all/parent-only,
  Cancel/Escape/backdrop, leaf close, remote target close, top-layer modal, focus containment
  and restoration, mobile bounds; no uncaught browser exceptions.
- Fixture conversations closed/workspaces archived. Reports, screenshots and probe harnesses:
  `reports/close-tab-cascade/` (gitignored). Private server + collector and browser/Vite
  processes are cleaned up after verification. No merge back or push.

**Human smoke check still requested:** open a real parent with nested subagent tabs;
close → Cancel/Escape, close → No (children stay), then close another group → Yes
(all descendants stop/close). At mobile width open the sidebar first; confirm all three
buttons remain reachable and the dialog is not clipped. Browser automation passed this
flow, but theme/layout should still be confirmed in the user's own browser.

## Milestone: reasoning block boundaries on the live stream (2026-10-22)

FE slice consuming a new ADDITIVE backend wire event. The kernel now emits one payload-free
`reasoning-end` `AgentEvent` per provider reasoning block (no version bump; opaque
signature/redacted data never leave the server). The pure chunk reducer mirrors the kernel's
builder — an open thinking chunk is flushed as its own provisional chunk; with none open it
appends an empty thinking chunk — so live thinking splits identically to HTTP history and the
replay/history de-dup lines up 1:1. The old merged-run alignment (`mergedRun`) stays as a
fallback for older servers/replays. The cache timer treats `reasoning-end` as resumed output;
`assertAgentEventExhaustive` covers it. Mirrored in `.dispatch/wire.reference.md`
(`TurnReasoningEndEvent`). No backend asks.

## Milestone: Delivery warning display delay + Flush label (2026-10-21)

Frontend-only: each keyed pending-input warning waits 1000 ms on mount (including
restored/rejected copies); removal/unmount cancels it. Storage, delivery, receipts,
and recovery remain immediate and unchanged. The queued Stop action now reads
**Flush** (text + aria-label), retaining its tooltip and existing stop action.
No contract/version/mirror changes or backend asks. Verification and scope:
`reports/delivery-warning-delay.md`; no deployment or live probe.

## Milestone: Subscription and input delivery regression (2026-10-21)

The user authorized one agent to implement both repositories in paired worktrees on
`feature/subscription-delivery-fix`.

- Discovery remains global for metadata and lifecycle status. Only the focused chat and
  explicit modal viewers subscribe to transcripts. Reopening a background chat catches up
  history and metrics. Chat watchers and surfaces each own at most 128 of the server's
  256 shared slots; unsubscribes precede replacement subscriptions.
- Backend overflow rejects a watcher with `chat.subscription-rejected` (or a scoped surface
  error) while preserving the socket and independent message admission. Logs include the
  connection ID, subscription counts, and close code/reason.
- `chat.send` and `chat.queue` use correlated receipts. `chat.accepted` follows opening
  message storage or queue insertion; `chat.queued` confirms compaction admission. Correlated
  `chat.error` identifies rejected input. Ordinary stream echoes are not durable receipts.
- Inputs and images are saved per conversation in localStorage before transmission. Saving
  failures preserve the composer and prevent transmission. A reload retains local-only tabs
  with saved input; unconfirmed/rejected copies are visible and can be discarded explicitly.
  There is no automatic retry: `requestId` is a correlation token, not an idempotency key.
- Reconnect recovery is limited to live viewers. Discovery and per-chat metrics requests
  coalesce; metrics permit at most one catch-up request behind an in-flight request.
- Contracts remain transport-contract 0.26.0 and wire 0.13.0. Built declarations were refreshed
  into the unchanged local file dependencies and the transport mirror was regenerated.
- Validation: frontend typecheck/check/build passed; **2,439 tests / 124 files**, twice.
  Backend typecheck/check passed; **4,150 Vitest + 184 Bun integration tests** passed.
  The real socket fixture validates 339 requests, admission at capacity, storage-before-receipt,
  and disconnect before receipt using isolated test ports and in-memory storage. Details in
  `reports/subscription-delivery-fix.md`. No merge or deployment is part of this task.

## Milestone: Review 3.6 — history epochs (2026-10-20)

- Consumed backend Step 3.5: required `historyEpoch` on HTTP history and WS compaction;
  unchanged `file:../backend/packages/*` links refreshed with `bun install`.
  Versions remain transport-contract **0.26.0**, wire **0.13.0**. Relevant declarations
  and documentation re-mirrored in `.dispatch/{transport-contract,wire}.reference.md`.
- IndexedDB meta persists epoch, including empty history; legacy missing epochs are
  untrusted and reloaded from cursor 0. Epoch changes clear transcript/watermarks and
  cache before a windowed reload. Broadcasts reuse the existing chat store and invalidate
  in-flight responses, including modal watches; unseen conversations stay lazy.
- Tail triggers coalesce into sequential reruns. Backfill validates epoch; earlier-history
  availability uses a known lower boundary / short-page exhaustion, not `seq > 1`.
  With no server `hasOlder` field, a full final page may require one empty-page probe.
- Public FE seams: cache/storage `historyEpoch` + `reset`, optional epoch on cache `commit`,
  optional epoch on chat `resync`, lazy transcript `invalidateHistory`, explicit earliest
  boundary on `selectHasEarlier`.
- Verification: typecheck/check/build green; full suite **2,186 tests / 115 files**
  (run twice on final files; see `reports/review-3.6.md`). Backend health unavailable
  on localhost:24203, so no live probe/server started. No new backend asks.

## Milestone: Local-path images in Markdown (`feature/local-image-markdown`, 2026-10-19)

**Slice status:** COMPLETE (frontend half; the backend route is implemented in parallel in
`../backend` from the same pinned contract).

- `features/markdown/logic/markdown.ts`: `renderMarkdown` / `renderMarkdownTail` accept per-conversation
  `image: { apiBase, cwd? }`. A custom marked renderer rewrites Markdown image token hrefs:
  `file://…` → decoded absolute path, `/abs/path` → itself, relative → joined to `cwd`, `~/…` passed
  through for backend expansion; `http(s)://`, `data:`, and other schemes are untouched. Local paths
  become `${apiBase}/local-image?path=<encodeURIComponent>` via `resolveImageUrl` (empty `apiBase` →
  root-relative). Rewriting happens on the token stream, so fenced/inline code is never touched.
- `logic/streaming-markdown.ts`: `advance(state, text, opts)` threads the same options through the
  settled, tail, and open-fence pipelines. The cache is keyed on `apiBase`/`cwd` so an async cwd load
  invalidates and re-renders settled blocks; string identity is preserved while the options are stable.
- `ui/Markdown.svelte`: new optional `image` prop. `ChatView` gains `cwd` and passes
  `image={{ apiBase: apiBaseUrl, cwd }}`; `ChatPane` supplies `store.httpBase` + `store.cwd`.
- Tests: `file://`, absolute, relative-with/without-cwd, empty-`apiBase`, http(s), `data:`, fenced-code
  exemption, streaming tail + settled prefix + options-change invalidation, and ChatView threading.
- Backend contract: expects `GET /local-image?path=` exactly as pinned in `PLAN.md` (absolute path,
  `~` expansion, raster whitelist, magic-byte sniff). No FE contract/type changes; **no backend asks**.
- Verification: typecheck **0 errors / 0 warnings**; tests **2,070 passed** (114 files);
  `bun run check` clean; build succeeds (existing bundle-size warning only). No wire/browser-effect
  adapter changes → no live probe required for this slice; manual inline-image smoke remains user-run.

## Milestone: Agent tab grid + subagent groups (`feature/agent-tab-grid`, 2026-10-15)
- FE: the tabs view is now a 2-column grid of identical fixed-height cards (`TabCard`); a tab with
  visible subagents is double-width and wrapped with them in a darker, nestable box
  (`TabGroupBox`, recursive). Boxes bleed outward (negative margin + equal padding) so every card
  stays on the same two columns at any depth. Pure model in `features/tabs/tab-groups.ts`
  (forest build, cycle-tolerant, candidates, bleed/gutter).
- Tab menu (`TabMenu`): right-click / touch-and-hold (500 ms, 10 px tolerance) / ContextMenu key →
  "Remove from group", "Ungroup N subagents", "Add to group under…" (excludes self, descendants,
  current parent). `AppStore.setTabGroup` is optimistic → `PUT /conversations/:id/tab-group`
  → reconciles to the response; reverts + reports on failure.
- CONSUMED (backend, same branch — plan `../backend/notes/agent-tab-grid-plan.md`):
  `ConversationMeta.tabGroupParentId?` (effective), `ConversationOpenMessage.tabGroupParentId?`,
  `ConversationTabGroupChangedMessage` (`conversation.tabGroupChanged`, null = ungrouped),
  `SetTabGroupRequest` / `TabGroupResponse`.

## Milestone: Tool-call cards final visual follow-up (`feature/tool-call-cards`, 2026-10-14)

**Slice status:** COMPLETE (frontend-only).

- Failed `edit_file` entries no longer carry header diffstats; attempted old/new content remains
  available in the expanded Call section. Regression covers pending edit → failed result.
- Orphan explanation is a muted italic note, without a Call heading: “This call is earlier in the
  conversation. Show earlier messages to see it.” No storage jargon in the user-facing copy.
- Pending headers now show muted `→ running…` on the right; it is replaced by the result on arrival.
- `edit_file` call detail is now a unified diff: one tinted row per line with its own −/+ gutter
  marker (classes `edit-diff*` — NOT `.diff`, which collides with DaisyUI 5's `diff` component).
  The output toggle is a neutral `btn-soft btn-xs`; the ↑ glyph shows only on "Show fewer lines".
- Reverted the `!scratch` / `!reports` Biome exclusions at the user's request. Moved only our
  generated TS/JSON probe artifacts from gitignored reports to `/tmp/tool-call-polish-artifacts`;
  the temporary harness has since been deleted.
- Verification: typecheck **0 errors/0 warnings**; full tests **1,931 passed ×2** (111 files);
  build succeeds (existing warnings only). `bun run check` reports ONLY `scratch/harness.ts`
  formatting/non-null assertions, (harness since deleted; check is now fully clean apart from the two existing config infos).
  Separate Biome check of all `src` and root source/config files passes with no errors/warnings.
- Screenshots at 1280px and 420px confirm the failed edit, orphan note, and pending header.
- Backend, contracts, mirrors and open asks: unchanged; no backend asks.

## Milestone: Tool-call card visual polish (`feature/tool-call-cards`, 2026-10-14)

**Slice status:** COMPLETE (frontend-only follow-up to the user's headless-browser visual pass).

- Card-width container queries prioritize call summaries: diffstats hide on narrow cards,
  response summaries switch to complete compact facts (never mid-word CSS truncation), and
  extremely narrow cards omit secondary response text. Error headers are simply `failed`
  (or `timed out`); full errors remain in the response body. Wide response labels are also
  budgeted by choosing a shorter whole fact instead of slicing arbitrary text.
- Edit badges now carry typed success/error tones. Orphans read “Call in earlier history”
  in muted italic text, with a natural expanded explanation and de-emphasized success glyph.
- Output folding uses a high-contrast primary button; in full-output mode it moves ABOVE
  the output and sticks to the transcript viewport while scrolling (no new scroll box).
- Call/Response are stronger heading elements with separators; generic input fields align
  key/value columns. Short scalar arrays render inline; long/nested values retain full JSON.
- Regression coverage expanded for compact facts, error privacy in headers, orphan wording,
  semantic badges/headings/fields, array formatting, and the output-control placement.
- Biome excludes local `scratch` fixtures and gitignored `reports` explicitly, so temporary
  visual harnesses/artifacts do not affect the source-code check. User fixture files untouched.
- Verification: typecheck 0 errors/0 warnings; tests **1,929 passed ×2** (111 files); check
  clean (existing 2 config infos only); build succeeds (existing app-store/bundle warnings).
- Browser: screenshots reviewed at **1280px and 420px**, collapsed and expanded, using the
  user's running fixture harness. CDP measured no horizontal viewport overflow and confirmed
  “Show fewer lines” remains at y=8px after scrolling 1,050px through the 111-line output;
  actual mouse clicks fold it without closing the card at both widths. Local captures in
  `reports/tool-call-polish/` (gitignored); scratch harness remains available on :24214.
- Backend, contract pins, mirrors, and open asks: **UNCHANGED; no backend asks**.

## Milestone: Tool-call cards (`feature/tool-call-cards`, 2026-10-14)

**Slice status:** COMPLETE (frontend-only, plan Steps 1–5 implemented; automated verification below).

- `core/chunks/groups.ts`: `ToolEntry` replaces `ToolBatchEntry`; every call becomes an independent
  `tool` render group, paired by `toolCallId` (including legacy chunks without `stepId`). Duplicate
  calls/results are deduped first-occurrence-wins; results whose calls were unloaded remain visible
  as orphan cards. Call/result provisional flags and step/turn provenance are retained.
- `core/metrics/place.ts`: metrics consume the new group shape; step metrics follow the LAST
  independent tool card of the step, with turn placement and legacy attribution unchanged.
- `features/chat/logic/tool-summary.ts`: pure built-in summary table + generic/MCP fallback,
  defensive unknown/JSON-string input normalization, call details, response facts derived from
  the existing result strings (including failures/timeouts/truncation/replacements/bytes), and
  first-six/last-six output folding above 12 lines (one terminal newline is not an extra line).
- `features/chat/ui/ToolCard.svelte`: one lazy, default-collapsed dropdown per bubble, including
  errors; spinner/✓/✗ alongside wrench/name + call/response summaries. Expanded body holds the
  call AND response. Long output has a `⋯ N more lines` toggle, full-output mode and a collapse-back
  button. Stable `t<toolCallId>` keys preserve card/output expansion through arrival/sealing and
  orphan-call page-in. Header truncation keeps long names/paths/results on one line.
- Contracts/pins/mirrors: **UNCHANGED** (`file:../backend/packages/{wire,transport-contract,
  ui-contract,layout-contract,tile-layout-contract}`); consumes existing `ToolCallChunk` and
  `ToolResultChunk` from `.dispatch/wire.reference.md`. No backend changes, contract asks or
  roadblocks. Richer structured result facts remain an optional future backend change, not needed
  for this feature. No network/storage/browser-effect adapter changes; no live network probe needed.
- Human visual pass still required: single shell call; parallel calls as separate bubbles; pending
  spinner → ✓/✗; collapsed errors + red response; edit old/new; >12-line preview + expand/back;
  narrow-layout truncation; reload mid-turn, open a pending card, and confirm sealing preserves it.
  Use the worktree's `bin/up` from its parent only after stopping the main stack (shared ports);
  backend startup remains user-owned.

### Verification

- `bun install`: succeeds (lockfile unchanged).
- `bun run typecheck`: 0 errors / 0 warnings.
- `bun run test` ×2: 1,915 passed per run (111 files).
- `bun run check`: clean (0 errors; existing Biome config-version/deprecation infos only).
- `bun run build`: succeeds (existing app-store initial-value and bundle-size warnings only).

## Milestone: Account usage view (`feature/account-usage`)

**Slice status:** COMPLETE + committed (both repos, `feature/account-usage`; implemented in BOTH
repos of one worktree like archive-workspaces).

- Backend contract `transport-contract@0.25.0` (additive): `GET /usage` (+ `GET /usage/:provider`,
  `?refresh=1`) → `AccountUsageResponse` (Claude + Codex subscription quota windows, cached
  server-side). Full contract: `../backend/notes/account-usage-frontend-handoff.md`; mirror
  re-generated in `.dispatch/transport-contract.reference.md`.
- FE: `src/features/account-usage` (pure `logic/view-model.ts` + `ui/AccountUsageView.svelte`,
  `ui/UsageBar.svelte`), store `accountUsage()`, sidebar view `account-usage` ("Usage").
  Each limit renders as a DaisyUI `<progress class="progress">` with a **pace marker** dot at the
  window's elapsed fraction (`(now − (resetsAt − durationMs)) / durationMs`) — the usage level
  that is "on track" to use the allowance exactly by the reset. Spend meters (no window) show no
  marker. Polls every 60 s (backend cache hit); Refresh button sends `?refresh=1`.
- Hyper (`transport-contract@0.26.0`): a third card with a `hyper:daily` credits bar (default 250/day)
  and an inline editor (allowance + local reset time → `PUT /usage/hyper/settings`). Hyper's API only
  reports the balance, so the reset time is manual or auto-detected from an observed refill.
- Open asks: none. Backend-side, inference responses from the claude/codex providers also update
  the cached windows between polls (kernel `providerResponseHeaders` event) — no FE change needed.

## Milestone: Workspace archiving (`feature/archive-workspaces`)

**Slice status:** COMPLETE + committed (both repos, `feature/archive-workspaces`).

### The contract change (made in the backend worktree, same branch)
- `@dispatch/wire` `Workspace.archived: boolean` (required; defaults `false`; legacy rows → `false`).
- `PUT /workspaces/:id/archive` + `DELETE /workspaces/:id/archive` — no body, create-on-miss,
  return the updated `Workspace`, **409 for `"default"`**.
- `GET /workspaces?archived=` — `true` → archived only, `all` → every workspace, absent/other →
  non-archived only (the home grid's default).
- Mirror: `.dispatch/wire.reference.md` updated with the 2026-09-20 delta.

### What the FE built
- `adapter/http.ts` — `archive(id)`/`unarchive(id)`; `list(archived?: "true"|"false"|"all")` passes
  the `?archived=` query.
- `logic/view-model.ts` — pure `applyArchived(list, id, archived)` (mirrors `applyStarred`).
- `store.svelte.ts` — `setArchived(id, archived)` (optimistic + revert-on-error + a reconciling
  `refresh()` so the archived tile leaves / the unarchived tile re-enters the active list);
  `archivedList` + `refreshArchived()` for the archived view.
- `ui/TileActionBar.svelte` — new **Archive** action (the right-click→select action bar).
- `ui/HomeHeader.svelte` — new **Archived** button opens the archived view.
- `ui/ArchivedWorkspaces.svelte` (new) — a modal listing archived workspaces (title, id,
  conversation count, last-activity) with **Unarchive** and **View** (navigates to `/<id>`).
- `ui/WorkspacesHome.svelte` — wires the Archive action + the Archived modal.

### Verification
- Backend: `tsc -b` 0 errors; `vitest run` 3041 passed (16 new: store archived block + app archive
  routes / `?archived=` filter); `biome check` clean.
- Frontend: `svelte-check` 0 errors; `vitest run` 1734 passed; `biome check` clean; `vite build` ok.

### Note for the user
- Archiving is reversible and touches no conversations. The archived tile's layout slot is freed
  (backend default filter excludes it → `tiles.sync` drops the entry); unarchiving re-appends it at
  the first free cell.


## Milestone: Layout plan 02 — provider consumption + layout WS + localStorage migration

**Slice status:** COMPLETE + committed (both repos, `feature/tiled-layout`).

### What the FE built
- `features/layout/adapter/http.ts` — `createLayoutHttp(httpBase, fetchImpl)`: typed
  `GET/PUT/DELETE /workspaces/:id/layout` with the 404-as-signal mapping (`notFound`) +
  malformed-200 degrade; tested against a scripted fetch edge.
- `features/layout/logic/migration.ts` — the §2.7 one-way best-effort migration decision
  (`migrationTree`/`storedPanelViews`/`sidePanelViews`): import the stored
  `dispatch.sidebar.views` selection ONLY when the provider's tree is the untouched
  DEFAULT_LAYOUT seed; the key is then never read again (bytes stay).
- `features/layout/store.svelte.ts` — `createLayoutStore(deps)`: owns the ACTIVE workspace's
  tree; probes on boot / workspace switch / `extensions-changed` (§2.6); WS `layout` push via
  `onServerTree` (non-active workspaces ignored); edits PUT the WHOLE tree lightly debounced
  (300ms) with rollback to the last server tree on failure (a PUT 404 flips to no-provider mode
  and KEEPS the edit — ephemeral, no rollback, no warning beyond the once-per-absence log);
  collapse state NOT touched (`dispatch.sidebar.open` unchanged).
- `adapters/ws/logic.ts` parses `layout` (`{ type, workspaceId, tree }`, light shape checks);
  `adapters/ws/index.ts` dispatches via `onLayout`; `core/wire/conformance.ts` exhaustive
  guard extended.
- `app/store.svelte.ts` — the app store owns the `LayoutStore` instance + exposes
  `store.layout`; wires `onLayout` → `layoutStore.onServerTree`, the boot probe
  (`{ boot: true }` arms the §2.7 migration), `onWorkspaceChanged` in `setActiveWorkspace`, and
  a re-probe in `onExtensionsChanged`.
- `app/App.svelte` — the tree is now `store.layout.tree` (was: local `$state` seeded from
  localStorage); edits flow to `layout.onTreeChange`; the `dispatch.sidebar.views` READ (boot
  seed) and WRITE (edit write-back) are RETIRED — its only reader is the one-way migration.
- **App tests updated:** the tests that pre-seeded `dispatch.sidebar.views` to make a sidebar
  view visible now drive the layout through the provider edge (`fakeFetchWithLayout([...])`
  serving `GET /workspaces/:id/layout`); the Extensions-view test is async (the tree arrives
  via the provider GET).

### Pinned contract versions + mirrors
- `@dispatch/transport-contract` (worktree dist rebuilt): consumed with the plan-02 types
  (`LayoutChangedMessage` + the `layout` union member; `LayoutTree` re-exported from
  `@dispatch/layout-contract`). Mirror `.dispatch/transport-contract.reference.md` updated with
  a **2026-09-04 delta note**.

### Findings / raises for the backend
1. **Outward events emitter is a noop in the composition root** (host-bin `createNoopEvents`):
   the plan-02 WS push therefore follows the LIVE `extensions-changed` path instead — a typed
   event hook (`layoutChanged` in `@dispatch/layout-provider-contract`) that transport-ws
   subscribes to and broadcasts verbatim. If a generic `host.events` → WS bridge ever ships,
   the kit's `emitChange` dep is the single wiring point to switch.
2. **§2.4 double-provide semantics VERIFIED from kernel source** (`kernel/src/bus/bus.ts`):
   `provideService` on an already-provided handle THROWS ("Only one provider per handle is
   allowed") → first-provider-wins; the host converts a throwing `activate()` into the
   disabled-with-reason grammar. No kit wrapper needed (the plan's conditional).

## Milestone: Plugin Manager UI — FE scope (plan 07, feature/plugin-system)

**Slice status:** COMPLETE + committed (both repos on the `plugin-system` worktree; FE consumes the
plan 05/06 backend contract via the `file:` deps).

### What the FE built
- **New feature module** `src/features/plugins/`:
  - `logic/types.ts` + `logic/view-model.ts` — the `PluginNode` normalization of
    `GET /plugins`' four row kinds (loaded / disabledWithReason / discovered / missing) into one
    shape for the tables + graph logic; tier grouping (Core → Providers → Standard).
  - `logic/cascade.ts` — `computeCascade` (client mirror of the backend's `computeUnloadCascade`:
    transitive dependents over the LOADED subgraph only) for the §8 cascade-uncheck warning.
  - `logic/prereqs.ts` — `autoCheckBackendPrereqs` (transitive, one-directional) for the §8
    auto-check; the manager issues the missing prereq loads before the target.
  - `logic/highlight.ts` — `dependencyHighlightSets` (one-hop both directions, across BOTH tables).
  - `logic/last-provider.ts` — `isLastProvider` + `unloadBlockReason` (client mirrors of the §8 locks).
  - `logic/workspace-row.ts` — modal checkbox semantics (`rowChecked`/`rowSelectable`/
    `rowBlockReason`/`stateLabel`) over the plan-06 `WorkspacePluginRow`s.
  - `adapter/http.ts` — typed calls to `GET /plugins`, `POST /plugins/scan`,
    `POST /plugins/:id/load|unload({force})|reload`, `GET /workspaces/:id/plugins`,
    `PUT /workspaces/:id/plugins/:pluginId`, `GET /workspaces/:id/plugins/providers-status`;
    blocked responses surface `reason` + `dependents`.
  - `store.svelte.ts` — `PluginsStore` (list/nodes, scan/load/unload/reload, per-workspace view
    with stale-clear + server-authoritative reconcile on 409, `onExtensionsChanged` hook).
  - `ui/` — `PluginManager` (loaded/discovered tables + missing strip, Scan, Reload, cascade
    confirm, force confirm with the "stops ALL agents globally" copy, hover highlighting),
    `PluginTable`/`PluginRow` (locked core rows: no checkbox, 🔒 + tooltip), `WorkspacePluginModal`
    (per-workspace enable/disable; unloaded = greyed + unselectable), `UnloadConfirmModal`.
- **Composition root** (`src/app/store.svelte.ts` + `src/App.svelte`):
  - the app store owns the `PluginsStore` instance + exposes `store.plugins` /
    `store.enabledProviderCount`;
  - sends `workspace.set` on boot (queued), on every `setActiveWorkspace`, and on reconnect
    (`onReopen` — a new connection is anonymous again);
  - `extensions-changed` → `pluginsStore.onExtensionsChanged()` + workspace-scoped model refresh +
    provider-status refresh (the catalog itself is re-pushed by the server);
  - `GET /models?workspaceId=<active>` on boot / workspace switch / extensions-changed;
  - `GET /workspaces/:id/plugins/providers-status` per active workspace → the §7 first-boot
    guardrail (`store.enabledProviderCount === 0` → prompt above the model picker).
- **Workspaces page** — global "Plugins" button in the header (→ `PluginManager`); per-card
  "Plugins" button (→ `WorkspacePluginModal`).
- **WS adapter** (`src/adapters/ws/`) — parses `extensions-changed` (dispatch →
  `onExtensionsChanged` option); `workspace.set` serializes via the existing `WsClientMessage` path.
- **Guardrail** (`features/chat/ui/ModelSelector.svelte`) — new optional `zeroProviders` prop renders
  the visible prompt. **Wire/conformance** — `core/wire/conformance.ts` exhaustiveness guards
  extended for the two new message types.
- **Tests:** 1356 pass (up from 1256): pure logic (cascade/prereqs/highlight/last-provider/
  view-model/workspace-row), adapter (routing + block mapping + degradation), store (fetch/refresh/
  reconcile/coherence hook), components (locked core, greyed-unloaded, cascade warn + accept,
  last-provider disable + tooltip, guardrail), ws parsing. typecheck 0 errors/0 warnings; biome
  clean (pre-existing store.test.ts warning + 2 config infos only); vite build succeeds.

### Pinned contract versions + mirrors
- `@dispatch/transport-contract`: consumed with the plan 05/06 types (`WorkspaceSetMessage`,
  `ExtensionsChangedMessage`, `PluginListResponse` family, `WorkspacePluginsResponse` family).
  Mirror `.dispatch/transport-contract.reference.md` updated with a **2026-09-03 delta note** (the
  body is NOT yet fully regenerated — the delta note tells readers to use the package sources).
- `@dispatch/ui-contract`: consumed with `SurfaceCatalogEntry.pluginId?`. Mirror
  `.dispatch/ui-contract.reference.md` updated with a 2026-09-03 delta note.

### Findings / raises for the backend
1. **§7.3-vs-§6.6 conflict resolved in favor of the shipped contract (FE mirrors the server).** Plan
   07's prose says Core rows are "checked-but-toggleable" in the workspace modal, but the SHIPPED
   backend (plan 06 §6.6 + `workspace-plugin-config`) marks core rows `locked: true` and refuses
   core PUTs with 409 `core-locked` (the backend's own comment says "the workspace modal renders
   core rows as locked"). The modal therefore renders core rows CHECKED + LOCKED (disabled checkbox
   + tooltip). If the backend ever relaxes this (plan 06's pure `isPluginUsable` already honors an
   explicit core `disabled`), the modal consumes `locked` and will unlock automatically — no FE
   change needed.
2. **In-use force attribution (plan-00 Q2):** the FE's force path is triggered by (a) a local
   cascade (≥1 loaded dependent → warn + force) or (b) a server refusal (any block reason → the
   force confirm with the global-stop copy). There is no FE-readable "in-use" flag on
   `PluginOpBlocked`; if the backend later adds a dedicated reason (e.g. `in-use`), the FE flow
   already handles it (any refusal → force offer).
3. **No live-probe yet:** this slice touches the wire (`workspace.set` send, `extensions-changed`
   parse). The static suites + build are green; a live probe against a running backend
   (`scripts/live-probe.ts` + a manual two-client check of the manager) is the remaining human step.

### Likely next asks (plan 08 / later)
- The `pluginId` on catalog entries is not yet rendered by the FE (no attribution UI requested).
- The renderer registry / dynamic FE loading / tiling is explicitly OUT of this plan (Addendum A) —
  a later dedicated agent's job; this plan's manager + modal are placement-agnostic.

---

## Milestone: Named Agents — FE scope (feature/named-agents)

**Slice status:** COMPLETE + committed. The FE Named Agents feature is implemented end-to-end against
the backend contract that shipped in parallel (both repos on the `named-agents` worktree).

### What the FE built
- **New feature module** `src/features/named-agents/`:
  - `logic/types.ts` — re-exports `NamedAgent` + `NamedAgentSelectionSnapshot` from `@dispatch/wire`
    and the `/named-agents` HTTP request/response types (`NamedAgentsResponse`, `NamedAgentResponse`,
    `DeleteNamedAgentResponse`, `CreateNamedAgentRequest`/`NamedAgentInput`) from
    `@dispatch/transport-contract`; defines the local port/result types.
  - `logic/validate.ts` — pure name/model validation (nonempty, case-insensitive-unique, canonical
    `<provider>/<model>`).
  - `logic/options.ts` — provider/model dropdown derivation from the `GET /models` catalog (numbered
    OpenCode numeric sort + friendly labels, matching the model picker).
  - `logic/snapshot.ts` — pure snapshot helpers (`snapshotFor`, `findNamedAgent`).
  - `logic/normalize.ts` — network-seam normalizers for the untyped `/named-agents` JSON.
  - `logic/auto-save.ts` — pure auto-save status/validity model (`idle/dirty/saving/saved/error`),
    `draftValidity`, `isDirty`, `saveStatusLabel`.
  - `ui/controller.svelte.ts` — the injected auto-save SHELL (debounce for name edits, immediate save
    for provider/model, monotonic sequence guard so an older response never overwrites a newer edit;
    create/update/remove ports injected).
  - `ui/NamedAgentCard.svelte` + `ui/NamedAgentsView.svelte` — the collapsible sidebar view (cards
    with name/provider/model controls + status line + Remove + Add + empty state).
  - `index.ts` + `manifest`.
- **Store** (`src/app/store.svelte.ts`): `namedAgents` state + CRUD (`refreshNamedAgents` /
  `createNamedAgent` / `updateNamedAgent` / `deleteNamedAgent`) over `GET/POST/PUT/DELETE /named-agents`;
  `namedAgentSnapshot` reactive state; `selectModel(model, snapshot?)` persists the raw model via
  `PUT /conversations/:id/model` WITH the `namedAgent` snapshot; draft promotion carries the snapshot;
  `refreshModel` restores the persisted `ModelResponse.namedAgent`.
- **Chat store** (`features/chat/store.svelte.ts`): `setNamedAgent(snapshot)` so `chat.send` includes
  `namedAgent` at conversation creation (draft path).
- **Tabs** (`features/tabs`): optional `Tab.snapshot` + `setSnapshot` reducer/store method (snapshot
  retention survives rename/remove + persists to localStorage with tabs).
- **Model selector** (`chat/model-select.ts` + `ModelSelector.svelte`): the synthetic **Named Agents**
  provider is ALWAYS first in the provider list; selecting a Named Agent resolves it to the raw model +
  records the snapshot; the UI shows `Named Agents -> <name>`. A retained snapshot of a renamed/removed
  agent still displays as an `(unavailable)` option (plan §7).
- **Composition root** (`src/app/App.svelte`): "Named Agents" view kind (+ loaded-modules manifest),
  `NamedAgentsView` wired to store CRUD ports, ModelSelector fed `namedAgents`/`namedAgentSnapshot` +
  `handleSelectNamedAgent`.
- **Tests:** pure logic (validate/options/snapshot/normalize) + auto-save status + controller
  (debounce, sequence guard, create/update/remove) + ModelSelector named-agent provider + app-store
  CRUD/snapshot. 1246 tests pass (up from 1226 before the slice), typecheck 0, biome clean (only the 2
  pre-existing config infos), `vite build` succeeds.

### Pinned contract versions + mirrors
- `@dispatch/wire`: consumed (now exports `NamedAgent` + `NamedAgentSelectionSnapshot`). Mirror
  `.dispatch/wire.reference.md` updated with a 2026-08-20 delta note.
- `@dispatch/transport-contract`: consumed (now exports the `/named-agents` types +
  `ChatRequest.namedAgent`/`ModelResponse.namedAgent`/`SetModelRequest.namedAgent`). Mirror
  `.dispatch/transport-contract.reference.md` updated with a 2026-08-20 delta note.
- `@dispatch/ui-contract`: unchanged (no surface-based named-agent mechanism — it is a regular FE view).

### Open asks / for the backend
- **None.** The FE aligns with the backend's shipped contract (backend commit
  `9039559 feat(named-agents): backend for Named Agents`). Verified: the backend's
  `list_agent_models` reads ONLY the named-agents registry (not the raw catalog), and
  `summon_agent` accepts `agent` (name/id) resolving locally to the raw model with an
  `unknown-agent`/exactly-one-of guard; the `/named-agents` HTTP CRUD surface
  (`GET/POST/PUT/DELETE`) + `ChatRequest.namedAgent`/`ModelResponse.namedAgent`/
  `SetModelRequest.namedAgent` snapshot wiring are all present in `transport-http`.
  There is nothing outstanding for the backend to implement.

### Findings
- The backend contract shipped the snapshot on `ChatRequest`/`ModelResponse`/`SetModelRequest` (richer
  than the plan's "recommended HTTP surface"); the FE uses it for the model-selector + draft promotion
  paths so backward/raw-model conversations are unaffected.
- **FE-only bug fix (no backend change):** row identity + duplicate-name validation in `ui/NamedAgentsView.svelte`
  previously keyed editable rows by their nullable persisted `id` (or captured `agent` object/null), so
  drafts (`agent === null`, `id === null`) falsely collided with their OWN name and saving/removing one of
  multiple drafts could reconcile all of them. Fixed by identifying rows solely by each `Row`'s stable
  numeric `key` for the other-names exclusion, the live `isNameTaken` predicate, and the save/remove
  reconciliation. Direct component-level regression coverage added in `ui/NamedAgentsView.test.ts`.

### Likely next asks
- A live probe (after the backend boots) exercising `/named-agents` CRUD + the synthetic-provider
  selection round-trips, when the user has the backend up. This is a joint/user step, NOT backend work —
  it needs the user to boot the backend (`bin/up`), then either repo's probe can run.
## Milestone: Win8-Start-style home page — FE-only (feature/win8-tiles-home)

**Slice status:** COMPLETE + committed (FE only; branch `feature/win8-tiles-home`). NO backend
changes, NO contract changes — the wire types and every endpoint consumed are unchanged.

### What the FE built
- The workspaces home page (`features/workspaces/ui/WorkspacesHome.svelte`) is rebuilt as a
  Windows 8 Start-screen-style TILE GRID (one tile per workspace):
  - **Pure layout core** `logic/tile-layout.ts`: `geometryFor(width, height)` → WIDE
    (landscape/desktop: 4 fixed ~120px rows, column-wise flow, 4×2 span cap) or TALL
    (portrait/mobile: 2 fixed columns, row-wise flow, 2×2 cap); `pack(entries, geometry)` —
    the ONLY order→coordinates transform (greedy first-fit in fill order, hole-free);
    `firstEmptySlot`, `insertAtFirstEmptySlot`, `mergeLayout`, `resizeTile`, `moveTile`,
    `sortByRecentActivity`, `clampSpan`, `sanitizeLayout`, `fillOrderKey`. Persisted data is
    ORIENTATION-INDEPENDENT `{ version: 1, tiles: [{ id, colSpan, rowSpan, order }] }` — order +
    spans only, NEVER positions; spans render-clamped per geometry (persisted values untouched).
  - **Persistence** via the existing injected `adapters/local-storage` adapter, key
    `dispatch.workspaces.tiles` (`tile-layout-store.svelte.ts`: thin reactive wrapper, ops
    sync/resize/move/placeFirstEmpty/sortByRecentActivity).
  - **Drag reorder** via a PURE pointer state machine (`logic/drag-controller.ts`): mouse =
    threshold-drag, click = tap-open; touch = long-press (500ms) lifts + selects, pre-lift
    movement cancels so vertical scrolling never fights the gesture; FLIP-animated reflow.
  - **Tile select + action bar**: right-click (desktop) / long-press (touch) →
    Open · Rename · Resize · Star/Unstar · Details · Plugins · Delete. Rename is the old card's
    inline semantics; Delete keeps the old confirm + store call; Details is a flyout holding the
    old card's default-cwd input + default-computer select (same store calls + error states).
  - **Resize**: Word-style insert-table hover picker (wide 4×2 / tall 2×2 small squares) with
    arrow-key/Enter/Escape support and a transient ghost footprint preview on the real grid.
  - **Header chrome** (fixed, outside the scroll region): "Dispatch" display title, a primary
    "New workspace" popover (same slug validation; creates via `PUT /workspaces/:id`
    create-on-miss and does NOT navigate — the new tile is placed in the FIRST EMPTY SLOT in
    fill order and enters rename mode), the global Plugins button, and a Sort-by-recent-activity
    overflow. Tall screens collapse the controls to icon buttons + a bottom-sheet popover.
  - Wide canvas: horizontal scroll + scroll-snap, wheel pans horizontally, pan arrow + thin
    scroll-position indicator. Starred workspaces render a tint (star is no longer a sort key —
    the persisted manual order rules; unknown workspaces append at the end).

### Backend notes
- The starred display semantics changed FE-side only: the home grid no longer sorts
  starred-first (`sortWorkspaces` remains for the list getter). The star's MEANING is untouched —
  it is still the concurrency-priority flag on `Workspace.starred`.
- The create flow now calls `ensure(id)` directly (today's navigation-implicit ensure) — same
  endpoint, no new surface.

### Follow-up: three drag-interaction bugfixes (2026-09-07, same branch, FE-only)
- **Stuck-tile drop** (`displacePlace` in `logic/tile-layout.ts`): the displacement preview
  returned placements SORTED BY STREAM ORDER, so as the dragged tile crossed stream positions the
  keyed `{#each}` moved its DOM node and the browser silently dropped its pointer capture — the
  subsequent `pointerup` never landed and the follow transform never cleared (phase stuck
  `"dragging"`). `displacePlace` now returns the INPUT render order (coordinates change only);
  `placeAtCell` re-sorts to stream order itself so the commit's order-renumbering semantics are
  unchanged.
- **Follow-transform grab offset** (`ui/HomeTileGrid.svelte`): the drag follow was a raw
  pointer-displacement translate, so a grab away from the tile's top-left corner made the tile
  jump (its origin rode the pointer instead of the grabbed point). `pointerdown` now records the
  grab offset (pointer − tile rect) and the transform cancels the tile's true grid anchor, so the
  GRAB POINT tracks the pointer.
- **Empty-cell hover** (`ui/HomeTileGrid.svelte`): pointer handling moved from the per-tile
  elements to the GRID CONTAINER, which `setPointerCapture`s the pointer and never gets
  re-parented/`pointer-events: none`/unmounted — so move/up stream to it over empty cells and off
  the canvas, and capture can never be lost to a DOM move again.
- **Mobile (tall) scroll fix**: the grid's root was `flex-1` inside a BLOCK parent (the workspace
  region), so it sized to its content and the scroller's `h-full` collapsed → `overflow-y-auto`
  never engaged and the shell's `overflow-hidden` clipped the extra tiles. The root is now `h-full`,
  giving the scroller a definite height so tall mode scrolls. Also: touch pointers are no longer
  `setPointerCapture`d at pointerdown (an early touch capture can suppress native panning in
  WebKit; touch already gets implicit capture and post-lift moves bubble to the container), keeping
  touch scrolling reliable while drags still work.
- **Drag append bound** (`dragAppendLimit` in `logic/tile-layout.ts`; `cellAt` in
  `HomeTileGrid.svelte`): the drop target is clamped to at most 3 columns (wide) / rows (tall)
  past the committed content edge (span-aware, measured on the COMMITTED layout so it can't
  ratchet mid-drag). The canvas stays content-driven while dragging — the preview extends it as
  the tile reaches toward the edge and it shrinks back when the gesture ends, bounded by the
  clamp — so the scrollbar grows/shrinks WITH the drag. (An earlier attempt pre-reserved the 3
  spaces at drag start as a fixed canvas; that made the view jump and created too much free
  space — reverted.)
- Verification: `typecheck` 0 errors/0 warnings, vitest 1689/1689 (incl. updated
  `tile-layout.test.ts` order assertions — coordinates unchanged), biome clean on touched files,
  `build` succeeds. Browser-only (pointer capture) — needs a human at the page to confirm the
  three fixes live (see commit message checklist).

## 2026-09-18 — feature/image-attach-compression (FE-only)

- **Attach-time image compression** in the chat composer: every staged image now carries a
  per-image `Compress` toggle (default ON, next to the remove button on the thumbnail,
  tooltip "PNG → JPEG + resize to 2048px"). ON re-encodes LOSSLESS sources (PNG/BMP) to
  JPEG q0.85, rescales to cap the longest edge at 2048px (never upscales, high-quality
  smoothing, alpha flattened onto white), and uses the result only under a smaller-wins
  rule. JPEG/WebP/GIF are sent verbatim (toggle hidden — recompressing lossy/animated
  images degrades them and saves nothing). OFF sends the original untouched bytes; the
  conversion is cached so flipping the toggle never re-encodes. Conversion is async at
  staging (the original stages immediately) and ANY failure silently falls back to the
  original — sending can never be blocked or broken by compression.
- **NO wire-contract changes.** `ImageInput`/`ImageChunk` are untouched; only the bytes a
  client chooses to put in `ChatRequest.images` change (still base64 data URLs, now
  sometimes `data:image/jpeg;base64,…` for a source that was `image/png`). No backend ask.
  This complements the backend's body-budget eviction safety net by shrinking images at
  the source so that path rarely triggers.
- Verification: `typecheck` 0 errors/0 warnings; vitest 1720/1720 (twice — incl. new pure
  logic tests for format selection/dimension math/smaller-wins + component tests for the
  toggle default/reversibility/caching/fallback/mimeType); biome clean; `build` succeeds.
  Manual browser sanity (paste a ~3MB PNG → staged size drops; uncheck → original;
  re-check → no visible re-encode; send works) still needs a human at the page.

## 2026-10-24 — feature/text-file-embeds

Implemented saved text-file chat embeds using standalone `[Plan](text-file:notes/plan.md)`.
Markdown renders inside a tool-call-style inset well with first/last six-source-line
preview, Expand/Collapse, Refresh/Retry, loading/empty/error states. Other text/code
files remain literal. Backend adds authoritative `/text-file-context` preflight and
bounded `/text-file` read routes; `TextFileQuery`, `TextFileResponse`, and
`TextFileContextResponse` are additive transport-contract0.26.0 exports mirrored in
`.dispatch/transport-contract.reference.md` (local file dependency unchanged).
Both guards are supplied; remote computer never falls back to local.

256KiB strict UTF-8, regular local files only, no truncation/final symlinks, live
current-disk views (not snapshots/watchers), no history injection/nested fetches.
Cache per mounted chat:32 active paths/4 loads; max8 embeds/message. Existing
Host/Origin trusted-network boundary retained (not new bearer/session auth).
Initial guidance reaches custom/default newly constructed prompts; persisted old
prompts unchanged until ordinary reconstruction. Warm parity verified. Explicit
per-turn systemPrompt bypass preserved.

Verification: typecheck0 errors/0warnings; Biome clean308 files; Vite build succeeds;
2586 tests pass twice with `NODE_OPTIONS=--no-experimental-webstorage`; two real
cross-repo ephemeral HTTP/Svelte integration tests pass opt-in. Plain Node26 test
run has26 baseline localStorage failures independently reproduced on unmodified
HEAD archive. Backend4277 Vitest/190 Bun green, typecheck/lint/standalone compile
green; standard external-Claude bundle has existing missing @dispatch/kernel issue.
No merge/push/deployment/shared restart. Full report:
`notes/text-file-embeds-implementation.md`. Human graphical desktop/mobile check
remains; no cross-repo contract asks open for this slice.

### Bun-native verification correction (2026-10-24)

Supersedes the Node-backed verification paragraph above: both repository test
scripts now explicitly launch Vitest with Bun (`bun --bun .../vitest.mjs`).
`bun run test` passes under Bun with no NODE_OPTIONS: frontend2587 passed/2
opt-in skipped repeatedly; backend4278 passed/9 existing SSH skips twice;
native Bun tests190 passed. `bun run test:text-file-live` passes2 against the
real ephemeral HTTP transport. Bun-run typecheck/lint/build pass (FE309 files,
backend754); existing build advisories/external-Claude wrapper limitation remain.

Corrected pre-existing Bun test assumptions (Bun.serve spy instead of global
replacement, directory ordering, homedir caching). Added prompt cycle detection
in tool-call summary serialization plus shared-reference regression test; the
Bun timeout is fixed, not increased. Live probe uses a native-signal jsdom
environment instead of Node-only utility APIs. No production wire/feature
semantics changed, no subagents/deployment/merge/push. Full final verification
is in the Bun-native follow-up of notes/text-file-embeds-implementation.md.
