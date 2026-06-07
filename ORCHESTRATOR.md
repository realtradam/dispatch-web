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
1. Plan the unit(s); split into dependency-topological **waves** of disjoint units, and
   WIDEN each wave where you can (§2a); one agent owns one unit.
2. Overlap/vocab check vs `GLOSSARY.md` before naming anything new (§5.6 — ask the
   user before coining a term).
3. Pre-author the cross-unit seam (§3) + write the per-summon TASK to
   `prompts/<unit>.md` (gitignored). RE-READ `.dispatch/rules/` + the §2 scoping map
   before each wave — summon from the files, NOT from memory.
4. Summon a wave via `opencode run` (§2); disjoint units run in PARALLEL (§2a).
5. Verify the reports + independently re-run typecheck/test/check/build (§4).
6. Resolve contract gaps / CRs / agent failures (§5, §5a).
7. Commit the milestone; update progress + the living handoff (§10).

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
**Run discipline:** do NOT background (no shell `&`); large timeout (e.g. 1800000 ms).
Each summon is its own FOREGROUND `opencode run`. **Parallelism = emit several summon
calls in ONE assistant message (concurrent tool calls), one per unit — NOT shell
backgrounding and NOT `&`.** Parallel summons ONLY for disjoint file sets (single-writer);
see §2a. `AGENTS.md` is auto-loaded by opencode — never `cat` it.

**GOTCHA — headless cross-repo read = HANG.** An agent's Read of any file OUTSIDE `--dir`
(here `dispatch-web/`) triggers a permission prompt that CANNOT be answered headlessly → the
run wedges until aborted. The `@dispatch/ui-contract` `file:` dep symlinks OUT of this repo, so
reading `node_modules/@dispatch/*` hangs. Mitigation (in place): the contract is mirrored in-repo
under `.dispatch/*.reference.md` — one per consumed backend contract (`ui-contract`, `wire`,
`transport-contract`) — agents read THOSE; the brief forbids `node_modules/@dispatch/*` reads.
**Regenerate the relevant snapshot whenever that contract changes** (re-pin → re-mirror → fan out
consumers), and point `package-agent.md` at every mirror. Agents are told: if you'd need a file
outside your scope, report it and STOP — never attempt the read.

### `.dispatch/rules/` scoping map (inline ONLY the matching rows)
- **Every FE agent:** `frontend-pure-core.md`, `frontend-no-ambient-state.md`.
- **Surface interpreter / renderer / field-component unit:** + `frontend-interpreter-generic.md`.
- **Transport / protocol / WS-client unit:** + `frontend-inject-transport.md`.
- **Any unit that builds `.svelte` UI (app shell, chat view/composer, surface field components):** + `frontend-styling.md`.

## 2a. Parallel execution — WAVES
Throughput comes from running disjoint units at once. Organise it as waves:
- **A wave = a set of units that (a) touch DISJOINT files and (b) have no compile-time
  dependency on each other** (each imports only already-built units + the pinned contracts).
  Launch a wave by emitting one summon `Bash` call per unit IN A SINGLE MESSAGE (§2). Later
  waves depend on earlier ones; the composition root (`src/app/`) is almost always the LAST wave.
- **Widen waves deliberately.** Before summoning, look for dependency edges you can remove so a
  unit moves into an earlier (wider) wave — e.g. make an adapter GENERIC so it doesn't import a
  feature's port (a `LocalStore<T>` instead of a tabs-specific store), or have the consumer define
  the port it needs so the producer/consumer split disappears. Fewer edges ⇒ wider waves ⇒ faster.
- **One writer per file, always** — even across waves. If two units would edit the same file, they
  are NOT separable; merge them into one unit or sequence them.
- **After a wave:** read every report, run the §4 checks ONCE for the whole wave (not per unit),
  commit the milestone, then start the next wave. Don't interleave a new wave before the prior one
  is green.

## 3. The per-summon `prompts/<unit>.md` is JUST the TASK
The invariant guardrails live in `package-agent.md` + the inlined rules. The TASK
states only the non-inferable, project-specific job: your unit's directory; the job
+ algorithm naming the contract types involved; the contract file(s) to read
(`.dispatch/*.reference.md`, a sibling's `index.ts`); the required named test cases.

**Pre-author the cross-unit seam.** When two units in the SAME wave must interoperate (a producer
+ a consumer that never see each other's internals), the orchestrator pins the shared interface in
BOTH prompts before summoning: name the exact port/type, say who DEFINES it and who IMPORTS it
(consumer-defines-port is the default — the adapter implements it), and which `index.ts` to import
from. That precise seam is what lets disjoint, blind units compose on the first try.

**Tell each agent it has company.** Add the concurrency note to every wave prompt: sibling units are
being built in OTHER dirs right now; `svelte-check`/biome are whole-project, so if a check reports
errors OUTSIDE your unit's dir, that's concurrent WIP — ignore it and ensure YOUR files are clean.
The orchestrator's post-wave run (§4) is the source of truth.

**Make agents IMPLEMENT, not deliberate.** A summoned owner must edit files + run its checks + write
its report in the one run. Prompts should say so explicitly when needed (see §5a).

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

**Concurrency caveat:** because `svelte-check`/biome/`vitest` are whole-project, an agent's OWN
verification (mid-wave) can transiently see a sibling's half-written file. Don't act on an agent
report's out-of-dir errors; YOUR post-wave run is authoritative. **Run the suite TWICE** when a wave
touched effects backed by a shared global (e.g. `fake-indexeddb`, `localStorage`) — to catch
cross-test pollution / flakiness before committing.

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
  orchestrator (via the living handoff, §10); on the new version, re-pin + re-mirror +
  fan out FE consumers. NEVER edit the backend repo.

## 5a. Agent-failure recovery patterns
- **Plan-only / "shall I proceed?" agent.** A summon sometimes returns a PLAN and stops without
  editing (no diff, no report). Detected via `git status` + a missing `reports/<unit>.md`. Re-summon
  the SAME TASK prefixed with: "IMPLEMENT THIS NOW — make all edits, run the checks, write the
  report; do not stop to plan or ask." Don't hand-fix its work.
- **Behaviour change reds a SIBLING's tests (test fan-out).** When a unit's new behaviour invalidates
  another unit's test assertions, the failing tests belong to that OTHER owner — summon it with a
  focused "fix these N failing tests to match the new behaviour" TASK (state the behaviour). The
  orchestrator does not edit feature tests itself.
- **Agent strayed out of its lane.** `git status` after every wave; if an agent touched a file
  outside its dir, decide per §5/§6: keep it if it's legitimately the orchestrator's lane (build/
  config/harness) and note it; otherwise revert + re-summon with a tighter scope. (Seen: an `app`
  agent edited root `vitest-setup.ts` instead of filing a CR — adopted because it's config, but it
  should have been a CR.)
- **Flaky green.** If a wave's suite passes once but the units use shared-global effects, re-run
  before trusting (see §4).

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
Slices 1–3 DONE + committed (surface system + WS; conversation transcript cache + delta streaming,
live-verified 9/9; tabs + model selector + DaisyUI/dracula). Plan in
`../arch-rewrite/notes/frontend-design.md` §10. Dev server: `bun run dev` (port 24204); full stack:
backend `bin/up` (HTTP :24203, surface WS :24205) + FE Vite :24204.

## 9. Live integration probe (effectful seams hide bugs unit tests can't)
Pure/unit green is necessary, NOT sufficient: a transport/storage SHELL only fails for real against a
running backend (the slice-1 WS-upgrade bug, and the secure-context `crypto.randomUUID` blank page,
only surfaced live). After a slice that touches the wire or browser effects, run a LIVE probe:
- A gated `scripts/live-probe.ts` (run with `bun scripts/live-probe.ts`) that drives the FE's REAL
  network-facing modules (`adapters/ws` + `core/chunks` + cache + HTTP sync) against `bin/up`. Keep it
  OUT of `bun run test` so a down backend never reds CI. It runs in Bun (global `WebSocket`/`fetch`);
  use `fake-indexeddb/auto` for IndexedDB.
- The backend is the USER's process (never boot it yourself — headless boot+probe HANGS + leaks
  servers, EADDRINUSE). Just CONNECT to the open ports; confirm reachability first (`curl :24203/
  health`). Probe with the REAL env (never an overridden empty key).
- Browser-only bugs (secure-context APIs, theme, layout) still need a human at the page — list the
  exact things to click and ask the user to confirm.

## 10. Living cross-repo handoff — `backend-handoff.md`
`lsp` can't span repos, so the FE↔backend seam flows through ONE rolling doc, `backend-handoff.md`
(repo root, tracked), kept current so the user can courier the whole seam at any time. It records: FE
slice status; the pinned contract versions + mirrors; OPEN asks / roadblocks for the backend;
findings (e.g. "model is per-turn, not persisted per conversation"); and likely NEXT asks. Update it
at every milestone and whenever a backend need arises; the user carries it across and brings the
reply back (e.g. `backend-handoff-reply.md`).
