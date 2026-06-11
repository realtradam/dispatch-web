# Backend handoff — LIVING doc (FE ⇄ backend, couriered by the user)

> **Purpose:** the single rolling document the FE orchestrator keeps current so the user can hand off
> the whole FE↔backend seam at any time — on completion OR at a roadblock. Updated continuously.
> **From:** dispatch-web orchestrator · **To:** arch-rewrite orchestrator · **Courier:** the user.
> `lsp` does NOT span the repos (ORCHESTRATOR §5) — every cross-repo ask flows through here.

_Last updated: 2026-06-12. **FE is current on `transport-contract@0.6.0` / `wire@0.5.0`.** All handoffs
to date are consumed: surfaces + WS, conversation transcript/metrics, tabs + model selector,
cache-warming (incl. authoritative timer + retention + cache-rate fix), **per-conversation cwd + LSP
status**, and **context size** (the `contextSize` field — `done` live + `TurnMetrics` persisted —
rendered as a current-usage readout above the composer).
**Open asks:** CR-1 (Loaded Extensions as a real table) + CR-2 (optional catalog `scope` flag) below.
The cwd/LSP draft-path verification (`backend-handoff-cwd-lsp.md`) came back **all ✅ confirmed** by the
backend (answers in their `frontend-lsp-cwd-handoff.md`) — see §2._

**Context-size handoff (`frontend-context-size-handoff.md`) → CONSUMED ✅.** Re-pinned `wire@0.4.0→0.5.0`
+ `transport-contract@0.5.0→0.6.0`; re-mirrored both `.dispatch/*.reference.md`; added "context size" +
"context window" to FE `GLOSSARY.md`. `core/metrics` now threads `contextSize` through the `done` fold +
durable metrics and exposes `selectCurrentContextSize` (LATEST turn's defined value, `undefined`⇒unknown,
never `0`, durable-wins-over-live); the chat store exposes `currentContextSize`; `ContextSizeBadge`
renders "N tokens in context" / "context size unknown" above the composer. 533 tests green. NO new
backend ask — but the max-limit denominator is now a live FE need; see §3.

---

## 1. Pinned backend contracts (consumed by the FE)

Pinned as `file:` deps: **`ui-contract@0.1.0`; `wire@0.5.0`; `transport-contract@0.6.0`**.

| Package | Used for |
|---|---|
| `@dispatch/ui-contract` | surfaces + surface WS protocol |
| `@dispatch/wire` | `Chunk`/`StoredChunk`(+`seq`)/`ChatMessage`/`AgentEvent`/`TurnSealedEvent`/`Usage`/`StepId` + metrics: `StepMetrics`/`TurnMetrics`, `usage.stepId`, `step-complete`, `done.durationMs`/`done.usage`, `tool-result.durationMs`, **`done.contextSize`/`TurnMetrics.contextSize`** |
| `@dispatch/transport-contract` | `ChatRequest`/`ModelsResponse`/`ConversationHistoryResponse`/`ConversationMetricsResponse` + `WarmRequest`/`WarmResponse` + `CwdResponse`/`SetCwdRequest` + LSP (`LspStatusResponse`/`LspServerInfo`/`LspServerState`) + WS chat ops + `WsClientMessage`/`WsServerMessage` |

Endpoints in use (HTTP **24203**, WS **24205**, CORS `*` incl. `PUT`):
`POST /chat` (NDJSON) · `GET /models` · `GET /conversations/:id?sinceSeq=<n>` ·
`GET /conversations/:id/metrics` · `GET`/`PUT /conversations/:id/cwd` ·
`GET /conversations/:id/lsp` · `POST /chat/warm` · WS `chat.send`→`chat.delta`.

Mirrored in-repo for headless agents: `.dispatch/{ui-contract,wire,transport-contract}.reference.md`
(regenerate on any contract bump; all current as of `transport-contract@0.6.0` / `wire@0.5.0`).

## 2. Open asks FOR THE BACKEND

### CR-1 — emit the **Loaded Extensions** surface as a true table

The user wants the Loaded Extensions surface rendered as a nice multi-column
table (e.g. `Name | Version | Trust | Scope`), listing **all** loaded extensions.

**Already covered — do NOT redo these (no contract change needed):**
- The `custom` field kind + `rendererId` + graceful-skip already exist in
  `ui-contract@0.1.0`. CR-1 uses that escape hatch — no `@dispatch/ui-contract` bump.
- The FE renderer is **done and shipped**: `SurfaceView` → `SurfaceTable` →
  shared `Table`, dispatched on `rendererId === "table"`. It renders the moment
  the surface emits the field below.
- The FE already groups consecutive `stat` fields into an aligned 2-column
  (label → value) table, so the current surface (one `stat` per extension:
  name → version) is **already readable as a table today**. CR-1 is the upgrade
  to real columns, not a fix for something broken.
- The "frontend modules" half of the Extensions view is **100% FE-owned**
  (aggregated from each FE feature's `manifest`) — backend has nothing to provide there.

**What I NEED from the backend to finish it:** replace the N per-extension
`stat` fields with a SINGLE `custom` field:
```ts
{
  kind: "custom",
  rendererId: "table",
  payload: {
    columns: string[],                      // header labels
    rows: (string | number | boolean)[][],  // each row aligns cell-for-cell to columns
  },
}
```
- Cells are coerced to strings; a malformed payload renders nothing (safe skip).
- `rows` should enumerate **every** loaded extension (all trust tiers / kinds),
  so "show all" is satisfied from this one surface.

**Optional (data quality, not a blocker):** extension manifest `version`s all
read `0.0.0` (unversioned). If real versions should appear in the table column,
bump each extension's manifest `version` — otherwise the column is all `0.0.0`.

### CR-2 (optional, low priority) — a `scope` flag on the surface catalog entry

The catalog (`SurfaceCatalogEntry`) carries no hint of whether a surface is GLOBAL or
CONVERSATION-SCOPED, so the FE follows the handoff's "always send the focused `conversationId`"
policy. That works (global surfaces ignore it; the FE's routing accepts the no-echo global reply),
but it means the FE **re-subscribes every surface — including global ones like `loaded-extensions` —
on every conversation switch**, which is needless churn (one redundant unsubscribe+subscribe round
trip per global surface per switch; no user-visible bug, the old spec is retained so there's no
flicker). An optional `scope?: "global" | "conversation"` on `SurfaceCatalogEntry` would let the FE
skip re-subscribing globals on switch. **Not blocking** — only raise if cheap.

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

## 3. Likely NEXT backend asks (heads-up, not yet requested)

- **Model max context-window LIMIT** (the denominator for context size) — the context-size handoff
  flagged this as the separate, later field. The FE now shows current size alone (e.g. "34,102 tokens
  in context"); once a per-model/per-turn `contextWindow` (max token capacity) ships, the FE can render
  `contextSize / limit` (e.g. "34,102 / 200,000") + a usage bar. GLOSSARY term reserved: "context window"
  = the limit (distinct from "context size" = current usage). **Likely the next ask** — raise when the
  backend can source the model's advertised window.
- `GET /conversations` — conversation list / sidebar (history explorer / switcher); could also expose a
  per-conversation "last model" so a reopened tab seeds its model from the server instead of localStorage.
- `POST /conversations/:id/cancel` — "stop generating".
- **LSP status over WS** (push) — today the FE HTTP-polls `GET /conversations/:id/lsp` on panel mount /
  cwd change + a manual refresh; a live surface/WS push would remove the manual refresh and reflect a
  server flipping to `error`/`connected` without a reload. (Backend flagged this as a future option.)
