# ORCHESTRATOR.md — driving dispatch-web (the frontend)

> **You are the orchestrator for the frontend repo.** You do NOT write feature
> code. You plan, author contracts/config/harness, summon owner-agents (one per
> unit), verify, resolve, keep the build green. Read fully before acting. Also
> read: `AGENTS.md` (the FE constitution you enforce), `GLOSSARY.md`,
> `.dispatch/rules/`, and the design home `../arch-rewrite/notes/frontend-design.md`
> (+ `../arch-rewrite/notes/restructure-plan.md` §1 for P1–P8). This MIRRORS the
> backend's `../arch-rewrite/ORCHESTRATOR.md` — read that for the deep rationale.

## 0. Mental model
The frontend is a **composition of feature modules + a surface host**, built with
the backend's methodology (pure core / inject effects / no ambient state / typed
contracts / one owner per unit / asymmetric testing). The team structure is
isomorphic to the module structure: agents communicate only through contracts. The
surface system (backend-declared, frontend-agnostic UI) is the modular UI
mechanism — see `frontend-design.md` §4. No feature (not even chat) is the
mandatory structural root.

## 1. The golden workflow
1. Plan the unit(s); respect dependency-topological order; one agent owns one unit.
2. Overlap/vocab check vs `GLOSSARY.md` before naming anything new (§5.6 — ask the
   user before coining a term).
3. Write the per-summon TASK to `prompts/<unit>.md` (gitignored).
4. Summon via `opencode run` (§2). Parallelize disjoint units only.
5. Verify the report + independently re-run typecheck/test/check/build (§4).
6. Resolve contract gaps / CRs (§5).
7. Commit the milestone; update progress (`frontend-design.md` / a tasks log).

## 2. Summoning agents (`opencode run`)
**Working dir:** the repo root `/home/tradam/projects/dispatch/dispatch-web` (so the
agent's `lsp` tool uses THIS repo's TS server).
**Model:** `opencode-go/mimo-v2.5-pro` for building.
**Invocation:** concatenate the brief + the scoped rules + the TASK; redirect output
to a log file; never use `-f`.
```bash
cd /home/tradam/projects/dispatch/dispatch-web && \
opencode run --dir /home/tradam/projects/dispatch/dispatch-web \
  -m opencode-go/mimo-v2.5-pro \
  "$(cat .dispatch/package-agent.md)
$(cat .dispatch/rules/frontend-pure-core.md .dispatch/rules/frontend-no-ambient-state.md)

## TASK
$(cat prompts/<unit>.md)" \
  > reports/<unit>.run.log 2>&1
```
**MANDATORY — capture output to a file, never display it** (the stream is huge and
will crash the harness). Read the agent's `reports/<unit>.md`; `grep`/`tail` the log
only for a specific error.
**Run discipline:** do NOT background; large timeout (e.g. 1800000 ms). One
non-backgrounded run per summon; parallel summons ONLY for disjoint file sets
(single-writer). `AGENTS.md` is auto-loaded by opencode — never `cat` it.

**GOTCHA — headless cross-repo read = HANG.** An agent's Read of any file OUTSIDE `--dir`
(here `dispatch-web/`) triggers a permission prompt that CANNOT be answered headlessly → the
run wedges until aborted. The `@dispatch/ui-contract` `file:` dep symlinks OUT of this repo, so
reading `node_modules/@dispatch/*` hangs. Mitigation (in place): the contract is mirrored in-repo
at `.dispatch/ui-contract.reference.md` — agents read THAT; the brief forbids `node_modules/
@dispatch/*` reads. **Regenerate that snapshot whenever `ui-contract` changes.** Agents are told:
if you'd need a file outside your scope, report it and STOP — never attempt the read.

### `.dispatch/rules/` scoping map (inline ONLY the matching rows)
- **Every FE agent:** `frontend-pure-core.md`, `frontend-no-ambient-state.md`.
- **Surface interpreter / renderer / field-component unit:** + `frontend-interpreter-generic.md`.
- **Transport / protocol / WS-client unit:** + `frontend-inject-transport.md`.

## 3. The per-summon `prompts/<unit>.md` is JUST the TASK
The invariant guardrails live in `package-agent.md` + the inlined rules. The TASK
states only the non-inferable, project-specific job: your unit's directory; the job
+ algorithm naming the contract types involved; the contract file(s) to read
(`@dispatch/ui-contract`, a sibling's `index.ts`); the required named test cases.

## 4. Verification (re-run yourself — trust nothing)
```bash
cd /home/tradam/projects/dispatch/dispatch-web
bun run typecheck   # svelte-check — 0 errors
bun run test        # vitest — note the pass count
bun run check       # biome (.ts/.js) — clean
bun run build       # vite build — succeeds
git status --short  # confirm the agent stayed in its lane
```
Trust = contracts + public surfaces + green checks + the report — NOT reading impl.
For pure units, confirm tests use NO internal `vi.mock` of our modules.

## 5. Errors, CRs, cross-repo
- **FE contract change** (a shared FE type / service handle): the owner edits it,
  runs `lsp references`, reports the consumer list; the orchestrator dispatches the
  fan-out.
- **CR for build/config** (root tsconfig/vite/biome/package.json): the orchestrator
  edits directly. **CR for impl** (a sibling, composition wiring in `src/app/`): the
  orchestrator SUMMONS the owning agent.
- **BACKEND contract change (cross-repo):** `lsp references` does NOT span the two
  repos. The FE pins `@dispatch/ui-contract` + wire types as a dependency. A needed
  backend change is reported UP and **couriered by the user** to the backend
  orchestrator; on the new version, re-pin + fan out FE consumers. NEVER edit the
  backend repo.

## 6. Restrictions (NEVER violate)
- Single-writer: never two agents on one file.
- The orchestrator never reads/edits feature impl (`.ts`/`.svelte`). It MAY edit:
  (a) locally-mirrored/consumed contract pins, (b) build/config (tsconfig, vite,
  biome, package.json, .gitignore), (c) harness/docs (this file, AGENTS.md,
  GLOSSARY.md, `.dispatch/`, prompts/, reports/). The composition root (`src/app/`)
  changes ONLY via a summoned owner. Roadblock → ask the user.
- The surface interpreter is GENERIC (no surface-id special-casing).
- biome covers `.ts`/`.js`; `.svelte` correctness is `svelte-check`'s.

## 7. Repo geography
```
/home/tradam/projects/dispatch/dispatch-web   (THIS repo)
  AGENTS.md  ORCHESTRATOR.md  GLOSSARY.md
  .dispatch/{package-agent.md, rules/frontend-*.md}
  src/app/        composition root (imports + wires feature modules + surface host)
  src/core/       PURE: transcript · cache · surfaces (interpreter) · protocol · wire
  src/features/<unit>/   logic/ (pure) · ui/ (svelte) · adapter/ (effects)
  src/adapters/   injected browser effects: WS client, fetch, IndexedDB, history
  prompts/ (gitignored)   reports/ (gitignored)
```
Backend (SEPARATE repo, contracts only): `/home/tradam/projects/dispatch/arch-rewrite`
— consume `@dispatch/ui-contract` (`file:` dep) + the wire types. Do NOT edit it.

## 8. Status
Slice 1 (surface system + WS) in progress — plan in
`../arch-rewrite/notes/frontend-design.md` §10. Scaffold verified (svelte-check +
biome + `vite build` green; `@dispatch/ui-contract` linked). Dev server:
`bun run dev` (port 24204).
