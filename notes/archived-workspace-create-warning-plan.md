# Plan — Warn when creating a workspace whose slug belongs to an archived workspace

Status: requested by user, ready to implement
Branch: `feature/archived-workspace-create-warning`
Scope: **frontend only**. No backend change (the backend already exposes everything needed).

---

## 1. User requirement

> "I want the frontend to warn me if I try to create a workspace that already
> exists and is archived (it should say you can't)."

So: when the user submits the **New workspace** form with a slug that matches an
existing **archived** workspace, the frontend must **not** create/ensure it and
must show a message saying it **can't** be created because a workspace with that
name already exists and is archived.

## 2. Current behavior (why it's wrong today)

- `HomeHeader.svelte` (`src/features/workspaces/ui/HomeHeader.svelte`) — the
  New-workspace popover. `submit()` validates the slug with `isValidSlug`, then
  calls `onCreate(slug)` and shows `result.error` in the existing `slugError`
  slot when `result.ok === false`.
- `WorkspacesHome.svelte` → `createWorkspace(slug)` calls `store.ensure(slug)`,
  then `store.refresh()`, `tiles.placeFirstEmpty(slug, …)`, and enters rename
  mode (`renamingId = slug`).
- `store.ensure` → `http.ensure` → backend `PUT /workspaces/:id`, which is
  **idempotent**: for an existing archived workspace it just returns it
  (`archived: true`) — no error. The active list (`GET /workspaces`, archived
  excluded by default) doesn't contain it, yet the home grid places a tile for
  it and enters rename mode. Silent and confusing.

Backend facts (no change needed):
- `GET /workspaces/:id` → the workspace incl. `archived: boolean`, or 404.
  Frontend adapter already has `http.get(id)` (`src/features/workspaces/adapter/http.ts`)
  — note it currently returns `null` for **both** 404 and network/other errors.
- `GET /workspaces?archived=true` → archived-only list (the store's
  `refreshArchived()` / `archivedList`, used by the Archived view).

## 3. Required behavior

1. On submit, **before** calling `ensure`, determine whether a workspace with
   that slug exists and is archived. Use an authoritative check against the
   backend (e.g. `GET /workspaces/:id`) — do **not** rely on `archivedList`
   alone, since it's only loaded when the Archived view is opened.
2. If it exists and is archived:
   - do **not** call `ensure`, do not refresh/place a tile, do not enter rename;
   - keep the popover open and show the error in the existing `slugError` slot,
     clearly saying it can't be created because an archived workspace with that
     name already exists. Suggested wording:
     `A workspace named "<slug>" already exists and is archived — you can't create it.`
     (It's fine to append a short hint that it can be restored from Archived
     workspaces, but don't add new UI controls for that.)
3. If it doesn't exist, or exists and is **not** archived → today's behavior,
   unchanged.
4. If the existence check itself fails (network/server error), don't silently
   swallow it in a way that creates an archived workspace's tile: either surface
   an error, or proceed exactly as today — pick one, keep it simple, and justify
   it in the report. (Distinguishing 404 from "request failed" may require a
   small adapter/store change; that's in scope.)
5. While the check is in flight, the existing `submitting` state should cover it
   (no double submits).

Follow the frontend's architecture rules in `AGENTS.md` (where decision logic
lives, store/adapter boundaries, Svelte 5 runes conventions, styling).

## 4. Out of scope
- Creating a slug that matches an existing **active** workspace (unchanged).
- Any backend change (e.g. making `PUT /workspaces/:id` reject archived ids).
- New UI for unarchiving from the popover.

## 5. Tests
- Unit/store test: creating an archived slug returns `ok: false` with the
  "can't create" message and does **not** call `ensure`.
- Non-archived existing slug and brand-new slug → `ensure` is called as before.
- Check-failure path per your choice in 3.4.
- Component test (`HomeHeader.test.ts` or `WorkspacesHome` level, whichever
  matches existing patterns): the message renders in the popover and the
  popover stays open.

## 6. Verification gate
`bun install`, `bun run typecheck`, `bun run test`, `bun run check`,
`bun run build` — all green. Commit to
`feature/archived-workspace-create-warning` only. Do not merge or push.
