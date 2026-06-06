# Dispatch Web — Constitution (root AGENTS.md)

> Loaded every session. Non-obvious, project-specific rules only. If a fresh
> frontier model could infer it from the code, it is NOT here (P6).
> Full design + rationale: `../arch-rewrite/notes/frontend-design.md` (and the
> backend's `notes/restructure-plan.md` §1 for P1–P8).

## What this is
The **web frontend** for Dispatch — a SEPARATE repo from the backend
(`../arch-rewrite`). It is a **thin shell + pure feature libraries + a surface
host**, NOT a default-SvelteKit ball of mud. It consumes the backend's typed
contracts (`@dispatch/ui-contract` + the wire types) over HTTP + a WebSocket.
There is **no mandatory "chat is the root"**: the app is a COMPOSITION of feature
modules + surfaces, assembled at the composition root; legitimate frontends may
compose without chat at all.

## Stack
Bun + Vite + Svelte 5 (runes) + TypeScript (strict). Biome for lint/format
(tabs, double quotes, semicolons, width 100) — **biome covers `.ts`/`.js` ONLY;
`.svelte` correctness is `svelte-check`'s job** (biome can't read Svelte template
semantics — it flags template-used vars as unused). Vitest + `@testing-library/
svelte` for tests.

## The non-negotiable rules
- **Pure core / injected shell.** Decision logic (reducers, view-models,
  formatters, parsers) is pure `input → output`: zero DOM, zero `fetch`/WebSocket,
  zero Svelte import. Effects (WebSocket, fetch, IndexedDB, history, clipboard)
  are INJECTED at the edges. State is a pure reducer; Svelte runes are a THIN
  reactive wrapper over it, never the home of logic.
- **No ambient state.** State is owned per-unit and passed explicitly. No
  module-global mutable store reached from everywhere — that is the old FE's
  "tools leak across tabs" / "model resets on tab switch" bug class.
- **Components are thin.** A `.svelte` file wires props/events to pure logic and
  renders; it holds no business logic.
- **One owner per unit.** Each feature module / file has exactly ONE editing
  agent. To change another unit you report the need up — you do not edit it.
- **Contracts are the only cross-unit surface.** You see other units' public
  exports (`index.ts`) and the imported `@dispatch/ui-contract` / wire types —
  never their internals. Needing internals ⇒ the contract is incomplete; report it.
- **The surface interpreter is GENERIC.** It switches on field KINDS
  (toggle/progress/...), NEVER on a surface id. No `if (surface.id === "...")` —
  that imports a feature's identity and breaks isolation.
- **Typed coupling.** Cross-feature links are typed imports/callbacks; no
  stringly-typed event bus. Discovery-by-id (surface catalog, subscribe) is
  sanctioned DATA flow, not a code reference.

## Backend seam (cross-repo)
The backend is `../arch-rewrite` (separate repo; `lsp references` does NOT span
the boundary). You consume `@dispatch/ui-contract` (surfaces) + the wire types as
a pinned dependency. Need a backend contract change? REPORT IT UP — the
orchestrator carries it across (couriered via the user). Never reach into the
backend repo.

## Surfaces (the modular UI mechanism)
A **surface** is backend-declared, frontend-agnostic data (fields + values +
actions), rendered generically. See `frontend-design.md` §4. You render surfaces;
you never special-case a specific one.

## Commands
- `bun run typecheck` — svelte-check
- `bun run test` — vitest
- `bun run check` — biome (`.ts`/`.js`)
- `bun run build` — vite build

## Reports
Finish a task → write `reports/<your-unit>.md` (gitignored): what you built, the
public surface, test/typecheck/build output, and any contract gaps / change-
requests (incl. backend-contract CRs for the orchestrator to courier).

## Vocabulary
Use `GLOSSARY.md`. Shared backend terms are canonical (conversation, turn, step,
chunk, AgentEvent, model name, …). FE terms: surface, region, field kind,
action / action ref, surface catalog. **"view" is RESERVED** (old-Dispatch sidebar
UX, future). Never invent a synonym.
