# search-backend-selection — Frontend Plan (research + planning, NOT implemented)

Goal: a "Search backend" dropdown under Settings that lets the user pick the active
search backend. GLOBAL setting persisted on the backend. Decided: exactly two
backend entries — "Firecrawl (self-hosted)" and "Umans (Exa)" — plus "None" as the
off state; save-on-change. Mirrors the backend plan in
`worktrees/search-backend-selection/backend/notes/`.

## 1. Current state (verified in this worktree)

- `src/app/views/SettingsPane.svelte` is currently FE-local only: a single
  `ChatLimitField` (chat limit, persisted browser-side). It takes `ports` and calls
  `store.setChatLimit` — so the pane already has a store seam for persistence.
- Server-persisted per-workspace settings today follow the heartbeat pattern: own
  feature dir (`src/features/heartbeat/`) with `logic/view-model.ts` + `ui/*.svelte`,
  store methods `heartbeatConfig()` / `setHeartbeatConfig()` (store.svelte.ts ~2303),
  own view pane (`HeartbeatPane.svelte`), registered via `register-views.ts`.
- `ChatLimitField.svelte` is the canonical settings-field pattern: `$state`
  value/saving/error/justSaved, `$effect` re-seed while untouched, dirty-guarded
  save button, Enter-to-save, spinner while saving.
- Dropdown precedent: `features/chat/ui/ModelSelector.svelte`,
  `ReasoningEffortSelector.svelte`, `HeartbeatView.svelte` all use native `<select>`
  with DaisyUI classes.
- Each FE feature exposes a `manifest` (name/description) listed in
  `ExtensionsPane.svelte`'s frontend-modules table — a new feature dir adds its
  manifest there.

## 2. Proposed UI

New feature `src/features/search-settings/`:

```
features/search-settings/
├── index.ts                    # public exports + manifest
├── logic/view-model.ts         # pure: options list, dirty check, validation
├── logic/view-model.test.ts
└── ui/SearchBackendField.svelte
    └── SearchBackendField.test.ts
```

**`SearchBackendField.svelte`** — modeled on `ChatLimitField`:
- Native `<select class="select select-bordered select-sm">` bound to local `$state`.
- Options: "Firecrawl (self-hosted)" and "Umans (Exa)" (disabled with a "not
  configured" suffix when `!configured` — i.e. no `UMANS_API_KEY`), **plus** a
  `"none"` option labeled e.g. "None (search disabled)".
- **Save on change** (decided): a select commits immediately — no separate Set
  button. Saving/saved/error feedback around the change.
- States: `saving` (spinner), `saved` ("Saved: <label>."), `error` (inline
  `text-error`, revert select to last persisted value on failure).
- Loading state: skeleton/disabled select while `GET` is in flight.
- Help text below: one line explaining the selection affects the `web_search`
  tool's *search* mode only — scrape/crawl still route to the self-hosted
  Firecrawl backend (and `map` is being removed from the tool entirely).

**Placement**: inside `SettingsPane.svelte`, under the Chat limit section (user
asked for "a dropdown under settings"). The config is GLOBAL, so no
workspace-switch re-seeding is needed — load once on first mount (or on settings
view open) and cache in the store; the field still re-seeds from the persisted
value after a successful save (ChatLimitField's `$effect` pattern).

## 3. Store / API wiring

`store.svelte.ts` (port contract + implementation):

```ts
searchBackendConfig(): Promise<SearchBackendConfigResult>;
setSearchBackend(backend: string): Promise<SearchBackendConfigResult>;
// state: searchBackendConfig | null (loaded), loading flag, last error
```

Calls the backend contract (see backend plan §2.4 — GLOBAL routes):

```
GET  /search/config → { backend, available: [{id,label,configured}] }
PUT  /search/config { backend } → { backend } | 400 | 503
```
(No capabilities field — the selection affects search mode only; scrape/crawl
always route to Firecrawl. `map` is removed from the tool entirely, per the
backend plan.)

- Wire types live in `@dispatch/transport-contract` / `wire` (backend plan) — FE
  types mirror them via the existing wire type imports.
- Load when the Settings pane mounts (lazy) or on workspace switch; cache like
  heartbeatConfig does.
- 503 (extension not loaded) → render the field disabled with "search not
  available" hint — graceful degradation, matching heartbeat's degrade philosophy.

## 4. Registering the module

- `features/search-settings/index.ts` exports `manifest` (name "Search Settings",
  description) → add to the `ExtensionsPane.svelte` frontend-modules list so the
  table doesn't drift from what's composed.

## 5. Tests / verification

- `view-model.test.ts`: options construction (available ∪ none, configured flag →
  disabled option), dirty check, revert-on-error value computation.
- `SearchBackendField.test.ts`: render options from config, save-on-change fires
  `save`, error state reverts selection, loading state disables.
- Store tests: `searchBackendConfig`/`setSearchBackend` wiring against a fake port,
  workspace-switch re-seed.
- Full `bun run typecheck` / `bun run test` / `bun run check` per AGENTS.md.

## 6. Decisions (shared with backend plan §4)

1. Dropdown entries: exactly "Firecrawl (self-hosted)" + "Umans (Exa)", plus
   "None (search disabled)". Umans sub-provider fixed to `exa`.
2. GLOBAL setting persisted to the backend (`GET/PUT /search/config`) — no
   workspace-scoped behavior.
3. Save-on-change with saved/error feedback (no Set button).
4. Relay output decided: hits only — the tool returns parsed `SearchHit[]`;
   the relay model's prose answer is discarded. No open questions remain.
