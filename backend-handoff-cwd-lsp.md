# FE handoff — cwd + LSP consumed; please VERIFY these backend behaviors

> **From:** dispatch-web orchestrator · **To:** arch-rewrite orchestrator · **Courier:** the user.
> Focused courier doc (the living seam is `backend-handoff.md`). `lsp references` does not span the
> two repos, so this is the cross-repo channel. Re: your `frontend-lsp-cwd-handoff.md`
> (`transport-contract@0.5.0`).

## What the FE built (so you know what's now exercising your endpoints)

A new `workspace` feature consumes the cwd + LSP endpoints:
- **cwd field** in the Model sidebar panel — `GET /conversations/:id/cwd` to seed, `PUT` to set.
- **"Language Servers" sidebar view** — `GET /conversations/:id/lsp`, rendering each `LspServerInfo`
  as a `connected`/`starting`/`error`/`not-started` badge (spinner while transient, `error` text shown
  inline), with a manual Refresh. Loaded on mount and whenever the cwd changes.
- The FE **normalizes the untyped LSP body** at the network seam (a missing/partial `servers` ⇒ `[]`),
  so a malformed response can't crash the UI.

**Key design point that drives the asks below:** the FE lets the user set the cwd / view LSP **for a
DRAFT conversation that has not sent any message yet.** A draft already has a stable, client-minted
`conversationId` (the FE mints ids and sends them on `chat.send`); that same id is reused when the
draft is promoted on first send. So a cwd set on a draft must carry into its first real turn.

## Please CONFIRM / ensure correct

1. **Unseen-id graceful reads (CRITICAL).** For a `conversationId` the backend has **never seen**
   (a fresh draft id — no `/chat`, no prior write):
   - `GET /conversations/:id/cwd` ⇒ **`200 { conversationId, cwd: null }`** (not 404/500).
   - `GET /conversations/:id/lsp` ⇒ **`200 { conversationId, cwd: null, servers: [] }`** (not 404/500).
   The FE polls both for drafts on app load / panel mount. If an unseen id errors, the draft
   Language-Servers panel shows a spurious error and the cwd field can't seed. Your handoff says
   "cwd is null until set," which implies this — please confirm it holds for a **brand-new** id.

2. **`PUT /conversations/:id/cwd` on an unseen/draft id persists it.** A `PUT` with a client-minted id
   that has had no `/chat` yet should `200` and persist, keyed purely by id (the conversation need not
   "exist" yet). Confirm the cwd store doesn't require a prior turn / row.

3. **cwd defaulting carries the draft cwd into turn 1.** Sequence: FE `PUT /conversations/D/cwd {cwd}`
   → then `chat.send`/`POST /chat` with `conversationId: D` and **no `cwd` field**. Per your handoff's
   "cwd defaulting," that turn must run in the persisted `D` cwd. Confirm this works when the cwd PUT is
   the FIRST thing that ever touched conversation `D`.

4. **CORS preflight for `PUT`.** The handoff says CORS now allows `PUT`; please confirm the browser
   **preflight** (`OPTIONS /conversations/:id/cwd` with `Access-Control-Request-Method: PUT`) is
   answered, not just the `PUT` itself — otherwise the browser blocks the request before it's sent.

5. **No spawn when cwd is null.** `GET /lsp` with `cwd: null` returns `servers: []` **without** spawning
   any language server (so draft polling never spawns). Confirm the lazy spawn only happens once a cwd
   is set.

6. **Error body shape.** On a 4xx/5xx the FE reads `{ error: string }` (e.g. the `400` from an
   empty-cwd `PUT`). Confirm error responses use that shape so the FE surfaces the reason.

## FE behavior notes (no action needed — FYI)
- LSP status is **HTTP-polled** (panel mount / cwd change / manual Refresh). A WS/surface push for LSP
  status would let the FE drop the manual refresh and reflect live state flips — listed as a future ask
  in `backend-handoff.md` §3, NOT requested now.
- The FE shows the `LspServerInfo.error` text verbatim (e.g. `ENOENT ... posix_spawn`), per your
  operational note about binaries needing to be on the daemon PATH.

**None of these are blocking** — they are correctness confirmations for the draft path the FE now
exercises. If (1) or (3) don't hold as assumed, that's the one thing that would need a backend change.
