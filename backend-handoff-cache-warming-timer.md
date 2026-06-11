# FE → backend handoff — cache-warming: next-warm timestamp + manual-warm timer reset

> **Courier doc** (dispatch-web → arch-rewrite, carried by the user). `lsp` does not span the repos.
> **From:** dispatch-web orchestrator · **To:** arch-rewrite orchestrator · **Courier:** the user.
> Focused ask split out of `backend-handoff.md` CR-3. Two requests, both ADDITIVE / backward-compatible.

## Why
The FE shipped a Cache Warming view: enabled toggle, minutes+seconds interval, a **live countdown to
the next warm**, a manual **Warm now** button, and a **history** of each warm's hit %. Two of those —
the countdown and a reliably-fresh "last cache %" — can't be done accurately from what the wire
exposes today. The FE currently fakes them best-effort (countdown anchored to the last warm the FE
*observed* + interval; manual warm % taken from the HTTP response because the surface doesn't refresh).
We'd like to make them authoritative.

## What I found in the backend (so these asks are precise, not guesses)
Read of `packages/cache-warming/src/warmer.ts` + `packages/transport-http/src/app.ts`:

1. **`POST /chat/warm` bypasses the warmer.** The handler (`transport-http/src/app.ts:240–289`) calls
   `warmService.warm(conversationId, …)` **directly**. It never goes through `CacheWarmer`, so a manual
   warm does NOT: re-arm the automatic timer, update the warmer's `lastPct`, or call `onSurfaceChange()`.
   ⇒ the cache-warming **surface does not refresh** after a manual warm (no `update` pushed), and the
   automatic timer keeps counting from the *previous* warm — a manual warm doesn't reset the cycle.
2. **No next-warm time is tracked.** `armTimer` (`warmer.ts:99`) arms a relative
   `timers.setTimer(fn, state.intervalMs)` but stores no absolute fire time, and `ConversationState`
   (`warmer.ts:61`) is `{ enabled, intervalMs, active, lastPct, token }`. There is nothing the surface
   could carry to tell a client *when* the next warm fires.

## Ask 1 — serve a machine-readable next-warm (and last-warm) timestamp on the surface
Record the absolute fire time when the timer is armed and expose it (plus the last warm's time) on the
**conversation-scoped `cache-warming` surface**, pushed on every change via the existing
`onSurfaceChange()` (warm completes, toggle, interval change, turn start/settle).

- `nextWarmAt`: epoch-ms the next automatic warm is scheduled to fire, or `null` when not scheduled
  (disabled, or `active` i.e. a turn is generating so the timer is cancelled).
- `lastWarmAt`: epoch-ms of the most recent completed warm, or `null` if none yet.

**Suggested shape — no `@dispatch/ui-contract` bump needed:** add ONE `custom` field to the spec
(the escape hatch already exists; non-supporting clients gracefully skip it):
```ts
{
  kind: "custom",
  rendererId: "cache-warming-timer",
  payload: {
    nextWarmAt: number | null,   // epoch-ms, or null when not scheduled
    lastWarmAt: number | null,   // epoch-ms, or null when never warmed
  },
}
```
(If you'd rather not add a field, a `stat` carrying an ISO/epoch string works too, but a machine-
readable `custom` payload is cleanest for the countdown — the FE needs the number, not a display
string.) The FE will read this in its cache-warming feature and render an exact countdown; it already
parses the surface fields itself, so wiring a `cache-warming-timer` renderer is a small FE change.

## Ask 2 — reset the automatic timer on a manual warm (and refresh the surface)
Confirm or change: a manual `POST /chat/warm` should be treated as "a warm just happened" for that
conversation, i.e. route it through (or notify) the `CacheWarmer` so it:
1. **re-arms the automatic timer** from *now* (the countdown restarts at the full interval), and
2. **updates `lastPct`** from the manual warm's result and **calls `onSurfaceChange()`** so subscribers
   get an `update` (this also fixes the surface "last cache %" not refreshing after a manual warm).

Per the source, none of this happens today (Ask-1 finding #1). The minimal change is a
`CacheWarmer.warmNow(conversationId)` that does what the automatic `fireWarm` already does — warm →
set `lastPct` → `onSurfaceChange()` → `armTimer()` — and have the `/chat/warm` handler call THAT
instead of `warmService.warm` directly. (If you intend manual warms to be a *separate*, non-cycle-
resetting probe, tell us and we'll keep the FE's manual entry purely local — but the user's intent is
that a manual warm resets the cycle.)

## What the FE does once this lands
- Drop the FE's best-effort countdown anchor and use `nextWarmAt` directly → exact, drift-free
  countdown that also reflects generation pauses (null while `active`).
- Render history from the authoritative surface signal (using `lastWarmAt` changes), removing the
  FE-side de-dup/identical-pct workaround noted in `reports/cache-warming-feature.md`.

## References
- Backend: `packages/cache-warming/src/warmer.ts`, `packages/transport-http/src/app.ts:240`,
  `packages/cache-warming/src/pure.ts` (surface spec builder), the cache-warming surface
  (`id:"cache-warming"`, region `"side"`, conversation-scoped).
- FE: `src/features/cache-warming/` (view-model + view), `backend-handoff.md` CR-3 (superseded by this
  doc), the original `frontend-cache-warming-handoff.md`.
- No contract version bump required if Ask 1 uses the `custom` escape hatch; Ask 2 is server-internal.
