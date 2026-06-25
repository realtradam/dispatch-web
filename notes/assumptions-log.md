# Assumptions log (dispatch-web)

> Recorded while working autonomously (user away). Raise these when the user returns.

## 2026-06-24 — CR-10: workspaceId on conversation.open / statusChanged

1. **Contract version already at 0.19.0 in the backend repo.** The `file:` dep in `package.json`
   points to `../arch-rewrite/packages/transport-contract`, which was already at `0.19.0` when the
   handoff arrived. No `package.json` version string needed changing — `bun install` re-synced the
   symlink. If the backend repo is later rolled back, the FE will fail to compile (the new required
   `workspaceId` field won't exist on the type).

2. **The `dist/` directory is owned by root** (likely from a previous root-run build). `bun run build`
   fails with `EACCES` when Vite tries to empty `dist/assets`. This is an environment issue, not a
   code issue — I verified the build succeeds with `--outDir dist-tmp` (a fresh directory I own, then
   removed). The user may want to `sudo chown -R tradam:tradam dist/` or remove it.

3. **Parser now rejects broadcasts missing `workspaceId`.** The WS parser (`logic.ts`) returns `null`
   for `conversation.open` / `conversation.statusChanged` messages that lack a string `workspaceId`.
   This is a breaking change for a mixed-version setup (old backend + new FE) — those broadcasts
   would be silently dropped. Assumed acceptable because the backend contract is updated in lockstep.

4. **Tab is opened but not focused when the conversation's workspace differs from the active one.**
   The FE creates the tab (stamped with the correct `workspaceId`) but does NOT navigate to that
   workspace or switch the active tab. The tab is hidden by the `tabs` getter filter
   (`t.workspaceId === activeWorkspaceId`) until the user navigates to the correct workspace. This
   matches the original "open without switching" behavior of the `conversation.open` handler. If the
   product wants auto-navigation to the conversation's workspace on `--open`, that's a separate FE
   product decision.

5. **CR-10 numbering.** The prior open ask was CR-9 (still open). I assigned this fix CR-10 in the
   handoff doc for tracking. If the backend used a different CR number, adjust.

## 2026-06-24 — CR-11: Per-conversation model persistence

1. **`refreshModel()` is called on every focus change** (boot, tab switch, workspace switch,
   reconnect) mirroring `refreshCwd` / `refreshReasoningEffort` / `refreshCompactPercent`. For a
   draft conversation the `GET /conversations/:id/model` request will 404 (the draft id isn't
   persisted yet); `res.ok` is false so it's a silent no-op. This matches how the other refresh
   functions behave for drafts.

2. **`refreshModel` only applies a non-empty string model.** The backend returns `model: null` when
   never set; the FE leaves `activeModel` unchanged in that case (falls back to the boot default or
   the last-known tab model). This avoids resetting the selector to `null`/`undefined` and crashing
   `ModelSelector`'s `splitModelName`. An empty string is also ignored defensively.

3. **`selectModel` persists only for real conversation tabs, not drafts.** A draft has no persisted
   conversation id yet; the first `chat.send` will carry `model` (the chat store still sends it),
   and the backend persists it on turn start. Drafts update session-local state only — same as the
   pre-change behavior.

4. **No "clear model" UI affordance added.** The backend supports `PUT /model` with `{ model: null }`,
   but the FE model selector has no "reset to default" button. This is a future product decision; the
   persistence path is ready if/when the UI adds it.

5. **No `model` field on `ConversationMeta`.** Following the precedent of `cwd` and `reasoningEffort`
   (fetched via dedicated endpoints, not on the list response). The FE fetches model on focus, not
   from `fetchOpenConversations`.
