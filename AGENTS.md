# Dispatch Web — Agent Guide (root AGENTS.md)

> Loaded every session — the single source of truth for working in this repo: the
> build constitution (code rules) + the workflow. Non-obvious, project-specific rules
> only — if a fresh frontier model could infer it from the code, it is NOT here (P6).
> Full design + rationale: `../arch-rewrite/notes/frontend-design.md` (and the
> backend's `notes/restructure-plan.md` §1 for P1–P8).
>
> **You are the single agent for this repo.** You plan, author the cross-unit
> contracts/types, write the feature code, verify, keep the build green, and keep the
> living backend handoff current. There is no separate orchestrator and no summoned
> sub-agents — you do all of it yourself.

## What this is
The **web frontend** for Dispatch — a SEPARATE repo from the backend
(`../arch-rewrite`). It is a **thin shell + pure feature libraries + a surface
host**, NOT a default-SvelteKit ball of mud. It consumes the backend's typed
contracts (`@dispatch/ui-contract` + the wire types) over HTTP + a WebSocket. The app
is a COMPOSITION of feature modules + surfaces, assembled at the composition root
(`src/app/`); there is **no mandatory "chat is the root"** — legitimate frontends may
compose without chat at all. Built with the backend's methodology: pure core / inject
effects / no ambient state / typed contracts / asymmetric testing.

## Stack
Bun + Vite + Svelte 5 (runes) + TypeScript (strict). Biome for lint/format
(tabs, double quotes, semicolons, width 100) — **biome covers `.ts`/`.js` ONLY;
`.svelte` correctness is `svelte-check`'s job** (biome can't read Svelte template
semantics — it flags template-used vars as unused). Vitest + `@testing-library/
svelte` for tests.

## Repo geography
```
src/app/        composition root (imports + wires feature modules + surface host)
src/core/       PURE: transcript · cache · surfaces (interpreter) · protocol · wire
src/features/<unit>/   logic/ (pure) · ui/ (svelte) · adapter/ (effects)
src/adapters/   injected browser effects: WS client, fetch, IndexedDB, history
.dispatch/      mirrored backend contracts (*.reference.md) + rules/
reports/ (gitignored)
```
Backend (SEPARATE repo, contracts only): `../arch-rewrite` — consume
`@dispatch/ui-contract` (`file:` dep) + the wire types. Do NOT edit it.

## The non-negotiable rules
- **Pure core / injected shell.** Decision logic (reducers, view-models, formatters,
  parsers) is pure `input → output`: zero DOM, zero `fetch`/WebSocket, zero Svelte
  import. Effects (WebSocket, fetch, IndexedDB, history, clipboard) are INJECTED at the
  edges. State is a pure reducer; Svelte runes are a THIN reactive wrapper over it,
  never the home of logic.
- **No ambient state.** State is owned per-unit and passed explicitly. No module-global
  mutable store reached from everywhere — that is the old FE's "tools leak across tabs" /
  "model resets on tab switch" bug class. Subscriptions are owned and disposed on unmount.
- **Components are thin.** A `.svelte` file wires props/events to pure logic and renders;
  it holds no business logic.
- **Contracts are the cross-unit surface.** Cross-unit dependencies go through a unit's
  public exports (`index.ts`) + the imported `@dispatch/ui-contract` / wire types — not
  another unit's internals. If you find yourself needing a sibling's internals, the
  contract is incomplete: fix the boundary, don't reach in.
- **The surface interpreter is GENERIC.** It switches on field KINDS (toggle/progress/…),
  NEVER on a surface id. No `if (surface.id === "…")` — that imports a feature's identity
  and breaks isolation. An unknown field kind / unregistered `custom` renderer → graceful
  skip, never a crash.
- **Typed coupling.** Cross-feature links are typed imports/callbacks; no stringly-typed
  event bus. Discovery-by-id (surface catalog, subscribe) is sanctioned DATA flow, not a
  code reference.
- biome covers `.ts`/`.js`; `.svelte` correctness is `svelte-check`'s job.

## Workflow
1. Plan the change; split a big change into dependency-ordered steps — build the shared
   contract/types first, then the producers, then the consumer / composition root.
2. Overlap/vocab check vs `GLOSSARY.md` before naming anything new — ask the user before
   coining a term (see Vocabulary).
3. Author/extend the cross-unit seam (the shared type/port/`index.ts` export) before
   writing the code that crosses it.
4. Write it: pure logic in `logic/` (zero DOM/fetch/Svelte), thin `.svelte` in `ui/`,
   effects injected at the edges (`adapter/` or props). Tests alongside.
5. Verify yourself (below).
6. Commit the milestone; update progress + the living handoff (see Backend seam).

## Verification (run these yourself — trust the green, not intent)
```
bun run typecheck   # svelte-check — 0 errors
bun run test        # vitest — note the pass count
bun run check       # biome (.ts/.js) — clean
bun run build       # vite build — succeeds
git status --short  # confirm you only touched what you meant to
```
Asymmetric testing: pure logic → vitest with NO internal `vi.mock` of our own modules;
components → a few `@testing-library/svelte` tests (fake only the OUTERMOST edge —
socket/fetch/clock, never a sibling module). Re-run the suite TWICE when a change touches
effects backed by a shared global (`fake-indexeddb`, `localStorage`) to catch cross-test
pollution. After a slice that touches the wire or browser effects, run a LIVE probe (below).

## Backend seam (cross-repo)
The backend is `../arch-rewrite` (separate repo; `lsp references` does NOT span the
boundary). You consume `@dispatch/ui-contract` + the wire/transport types as pinned `file:`
deps. **Read the in-repo mirrors `.dispatch/*.reference.md`, never `node_modules/@dispatch/*`**
(they symlink out of the repo); regenerate the relevant mirror whenever a contract changes.
- **FE contract change** (a shared FE type / service handle): edit it, run `lsp references`,
  and update every consumer yourself.
- **Backend contract change:** `lsp` does not span repos — REPORT IT UP via the living
  handoff `backend-handoff.md` (repo root, tracked); the user couriers it to the backend and
  brings the reply back. On the new version: re-pin the `file:` dep → re-mirror the relevant
  `.dispatch/*.reference.md` → update FE consumers. NEVER edit the backend repo.

Keep `backend-handoff.md` current at every milestone: FE slice status, pinned contract
versions + mirrors, open asks / roadblocks for the backend, findings, and likely next asks.

## Surfaces (the modular UI mechanism)
A **surface** is backend-declared, frontend-agnostic data (fields + values + actions),
rendered generically. See `frontend-design.md` §4. You render surfaces; you never
special-case a specific one.

## Live integration probe (effectful seams hide bugs unit tests can't)
Pure/unit green is necessary, NOT sufficient: a transport/storage SHELL only fails for real
against a running backend (the slice-1 WS-upgrade bug, and the secure-context
`crypto.randomUUID` blank page, only surfaced live). After a slice that touches the wire or
browser effects, run a LIVE probe:
- `scripts/live-probe.ts` (`bun scripts/live-probe.ts`) drives the REAL network-facing modules
  (`adapters/ws` + `core/chunks` + cache + HTTP sync) against the running backend. Keep it OUT
  of `bun run test` so a down backend never reds CI. It runs in Bun (global `WebSocket`/`fetch`);
  use `fake-indexeddb/auto` for IndexedDB.
- The backend is the USER's process — never boot it yourself (headless boot+probe HANGS + leaks
  servers, EADDRINUSE). Confirm reachability first (`curl :24203/health`), then CONNECT. Probe
  with the REAL env (never an overridden empty key).
- Browser-only bugs (secure-context APIs, theme, layout) still need a human at the page — list
  the exact things to click and ask the user to confirm.

## Commands
- `bun run typecheck` — svelte-check
- `bun run test` — vitest
- `bun run check` — biome (`.ts`/`.js`)
- `bun run build` — vite build
- `bun run dev` — Vite dev server (port 24204). Full stack: backend `bin/up`
  (HTTP :24203, surface WS :24205) + FE Vite :24204.

## Status
Slices 1–3 DONE + committed (surface system + WS; conversation transcript cache + delta
streaming; tabs + model selector + DaisyUI/dracula), plus per-conversation cwd + LSP view,
context size, cache-warming (+ retention/timer), markdown, smart auto-scroll, and
multi-client live view (subscribe/reconnect + the user prompt on the event stream). Plan in
`../arch-rewrite/notes/frontend-design.md` §10.

## Reports
Optionally record a finished milestone in `reports/<name>.md` (gitignored): what you built,
the public surface, verification output, and any contract gaps / backend-contract CRs.

## Vocabulary
Use `GLOSSARY.md`. Shared backend terms are canonical (conversation, turn, step, chunk,
AgentEvent, model name, …). FE terms: surface, region, field kind, action / action ref,
surface catalog. **"view" is RESERVED** (old-Dispatch sidebar UX, future). Never invent a
synonym.
