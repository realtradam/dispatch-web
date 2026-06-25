# Backend handoff — Workspaces (FE → backend) — courier doc

> **From:** dispatch-web orchestrator · **To:** arch-rewrite orchestrator · **Courier:** the user.
> Companion to the living `backend-handoff.md` (new open ask, §2). 2026-06-23.
> `lsp references` does NOT span the two repos, so this is the cross-repo channel.
> FE is current on `ui-contract@0.2.0` / `transport-contract@0.15.0` / `wire@0.11.0` (686 tests green).
> **This is a design ask, not a bug report.** Please review, analyze, propose an implementation plan,
> and surface any gaps / questions back. The FE will adapt to whatever shapes you land on.

---

## 1. What we're building (the FE product behavior)

A **workspace** is a named, URL-driven grouping of **conversations** that owns a **default cwd**.
Every conversation belongs to exactly one workspace; a workspace's default cwd is used by its
conversations that haven't set their own per-conversation cwd.

Routing (net-new on the FE — there is no router today):
- **`/`** (no path) — home: lists all workspaces (title, slug, last activity). The user can **delete** a
  workspace here.
- **`/<workspace-id>`** — opens that workspace and loads its tabs.
- **Visiting `/<id>` when the workspace doesn't exist → it is created at that point** (title defaults to
  the id; the user can rename the title later). The **id (the URL slug) is immutable**; the **title is
  display-only and editable**.

Workspaces are **backend-owned** (so cross-device just works): the workspace entity (title, default-cwd),
and each conversation's `workspaceId`, live server-side. The FE is a thin client over your contracts and
ships no business logic you don't expose (per the FE's constitution).

### Naming note (FE-internal, NO backend impact)
The FE already has a `features/workspace` module — but it is the **per-conversation cwd-field + LSP-status**
module (it consumes `GET`/`PUT /conversations/:id/cwd` + `GET /conversations/:id/lsp`), NOT this concept.
We are renaming that module to `features/cwd-lsp` so the new feature takes `workspaces`. Flagged only so
the backend isn't confused by the FE module name; it has **zero contract impact**.

---

## 2. What the FE needs from the backend (the proposed contract surface)

Everything below is the FE's *requirement + proposed shape*. **You own the final shapes** — pick the
verbs/field-names/type-homes that fit the backend, and ask back where a requirement is unclear or conflicts
with your design.

### 2.1 Workspace entity + conversation assignment
- A `Workspace` type (your call: `@dispatch/wire` alongside `ConversationMeta`, or `@dispatch/transport-contract`
  with the endpoints): `{ id: string (the URL slug, immutable), title: string (defaults to id on creation,
  editable), defaultCwd: string | null, createdAt: number, lastActivityAt: number }`.
- `ConversationMeta` gains an additive **`workspaceId: string`**. Conversations created with no workspace
  ⇒ `"default"` (the fallback). Legacy conversations (no `workspaceId` persisted) should be treated as
  `"default"` — ideally **no backfill needed**; `ConversationMeta.workspaceId` reads as `"default"` for them.

### 2.2 Conversation creation carries the workspace
Conversation-creating ops gain an optional additive `workspaceId` (default `"default"`) so the backend
stamps the conversation's workspace at creation:
- `ChatRequest` (HTTP `POST /chat`) and `ChatSendMessage` (WS `chat.send`).
- The queue ops that can start a turn: `POST /conversations/:id/queue` (`QueueRequest`) and `chat.queue` (WS).

Note the FE mints `conversationId`s client-side and sends them on `chat.send`; the `workspaceId` travels
alongside. **Existing invariant preserved:** `chat.send` still **omits `cwd`** (sends `undefined`) — the
backend resolves the effective cwd from the workspace default (see 2.4).

### 2.3 Workspace endpoints (your call on exact verbs/shapes)
- **`GET /workspaces`** — list all (for the `/` home). Sorted by `lastActivityAt` desc. Enough for a picker
  (id, title, timestamps; a conversation count would be nice but optional).
- **`GET /workspaces/:id`** — **create-on-miss**: if absent, create it (`title = id`, `defaultCwd = null`)
  and return it; if present, return it. Idempotent. This is the route-enter action when the user visits
  `/<id>`. (We note GET-with-side-effects; you already lazy-spawn LSP on `GET /conversations/:id/lsp`, so
  there's precedent — but feel free to propose `PUT`/upsert instead; see open Q4.)
- **`PUT /workspaces/:id/title`** (body `{ title }`) — rename (display only; id/URL unchanged).
- **`PUT /workspaces/:id/default-cwd`** (body `{ defaultCwd }` or `{ cwd }`) — set the workspace default cwd.
  `null`/empty = "no default; fall through to the server default."
- **`DELETE /workspaces/:id`** — delete a workspace. **Open question (Q1): what happens to its conversations.**

### 2.4 cwd resolution (backend-owned — the FE does NOT re-implement)
At turn time, resolve cwd as: **explicit conversation cwd (`GET /conversations/:id/cwd`)
> `workspace.defaultCwd` > server default.**
- `GET /conversations/:id/cwd` should keep returning the **explicit** conversation cwd (`null` =
  "inheriting the workspace default"), so the FE can render "inherited from workspace X" vs "explicit."
  The FE reads `workspace.defaultCwd` separately to show the inherited value.
- `GET /conversations/:id/lsp` must root at the **effective** cwd (conversation cwd ?? `workspace.defaultCwd`),
  so LSP spawns against the workspace default when the conversation hasn't set its own.

### 2.5 The `default` workspace
- Always present, **non-deletable**, id `"default"`. It is the fallback for unassigned conversations. The FE
  navigates to `/default` for it. **Please confirm** the backend guarantees its existence on boot and rejects
  `DELETE /workspaces/default`.

### 2.6 Conversation list filtered by workspace
- `GET /conversations` gains an additive **`?workspaceId=<id>`** filter (composable with the existing
  `?status=` and `?q=`). Used by the FE to restore a workspace's active/idle conversations as tabs on a new
  device (the existing cross-device tab-restore path, now workspace-scoped). The FE is **not** building a
  full conversation-browser sidebar in this iteration — just the restore query.

---

## 3. Open questions for the backend to analyze + decide (FE will adapt)

These are implementation decisions the FE defers to the backend. Please analyze each, pick an approach,
and ask back wherever the FE's requirement is unclear or conflicts with your design:

1. **Delete a workspace → fate of its conversations.** Reassign them to `"default"`? Block deletion while
   non-empty? Delete them? The FE's only hard requirement: deleting a workspace must **not orphan/hide**
   conversations (they must remain reachable). You decide semantics; the FE renders whatever you return.
2. **"Clear to inherit" for conversation cwd.** With inheritance, a user may want to unset an explicit
   conversation cwd to fall back to the workspace default. Today `PUT /conversations/:id/cwd` with `""` ⇒
   `400 { error }`. Do you want to (a) treat `null`/empty as "inherit" (relax the 400), (b) add
   `DELETE /conversations/:id/cwd`, or (c) defer the affordance (v1: a conversation cwd, once set, can be
   changed but not unset)? The FE is fine with any.
3. **Workspace lifecycle over WS.** For live cross-device refresh of the home list (a workspace
   created/renamed/deleted on device A appears on device B's `/`), should you broadcast
   `workspace.created` / `workspace.updated` / `workspace.deleted` (mirroring `conversation.statusChanged`),
   or is the FE's fetch-on-mount + manual refresh sufficient for v1? The FE can ship either way; WS push is
   a nice-to-have, not a blocker.
4. **create-on-miss vs. explicit create.** Is `GET /workspaces/:id` create-on-miss acceptable, or would you
   prefer a distinct `POST /workspaces` / `PUT /workspaces/:id` (upsert) the FE calls on route-enter? The FE
   just needs "visit URL ⇒ workspace exists" in one round-trip.
5. **Slug validation.** The id is a URL path segment. FE proposes URL-safe `[a-z0-9-]`, lowercase,
   length-bounded. Please define the canonical validation + whether you normalize or reject. Also: should
   creation reject slugs colliding with reserved names (`default`)?
6. **Where do the types live?** `Workspace` in `@dispatch/wire` (like `ConversationMeta`) or
   `@dispatch/transport-contract` (with the endpoints)? And the request/response shapes for the workspace
   endpoints — your call; mirror the existing `TitleResponse`/`SetTitleRequest` style if it fits.
7. **Cross-device tab set (confirm the FE's model).** The *open-tab set* stays **per-device** (FE
   localStorage); cross-device sync covers workspaces + conversations + assignments, and a fresh device
   restores a workspace's active/idle conversations as tabs via
   `GET /conversations?workspaceId=<id>&status=active,idle`. Does the backend need to do anything beyond
   exposing `workspaceId` on `ConversationMeta` + the `?workspaceId=` filter? (FE assumes **no**.)
8. **Compaction interaction.** `conversation.compacted` yields a `newConversationId` (see
   `ConversationCompactedMessage`/`CompactionResult`). Should the new (post-compaction) conversation inherit
   the original's `workspaceId`? The FE assumes **yes**.

---

## 4. How the FE will consume it (so you can shape the contract)

- Route enter `/<id>` → `GET /workspaces/:id` (create-on-miss) → render the workspace view + its tabs.
- `/` home → `GET /workspaces` → list; delete via `DELETE /workspaces/:id`; (maybe) a "new workspace" input
  that navigates to `/<slug>` (creation via the visit).
- New conversation in workspace W → `chat.send` / `POST /chat` with `workspaceId: W.id` (cwd still omitted).
- The CwdField (the renamed `cwd-lsp` module) shows explicit cwd (`GET /conversations/:id/cwd`) vs inherited
  (`workspace.defaultCwd`).
- On workspace entry, restore active/idle conversations as tabs:
  `GET /conversations?workspaceId=<id>&status=active,idle`.

---

## 5. Priority / sequencing

Not a hard blocker — the FE can begin FE-only scaffolding (the routing adapter + a workspace-view shell
with provisional local types) in parallel, but the **cross-repo types must land before the FE wires real
data.** Please bump `wire` / `transport-contract` / `ui-contract` as needed and note the changes in the
reply so the FE re-pins the `file:` deps + re-mirrors the relevant `.dispatch/*.reference.md`.

**Asks back to you, the backend:** (a) a review of the above for feasibility/fit; (b) a concrete
implementation plan (final types, endpoints, resolution mechanics); (c) answers/decisions on Q1–Q8; and
(d) any gaps or questions YOU have about the FE's requirements. The FE will then build against the landed
contract.
