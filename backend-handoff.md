# Backend handoff — Dispatch Web (tracked; kept current at every milestone)

> This living document is the cross-repo courier between the FE (this repo) and the BACKEND
> (`../backend`, a separate repo). `lsp` does not span the seam — the USER carries updates across.
> Per AGENTS.md "Backend seam": FE contract changes are edited + consumers updated here; BACKEND
> contract changes are REPORTED UP here, and on the new version the FE re-pins the `file:` dep,
> re-mirrors `.dispatch/*.reference.md`, and updates consumers. NEVER edit the backend repo.

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