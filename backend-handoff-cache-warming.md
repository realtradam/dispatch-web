# Cache-warming lifecycle handoff (FE → backend) — CR-4 — **RESOLVED ✅ 2026-06-12**

> **Closed.** Backend reply: `../arch-rewrite/frontend-cache-warming-lifecycle-handoff.md`
> (`ui-contract@0.2.0` + `transport-contract@0.9.0`). All asks shipped; FE consumed + live-probed
> 17/17 (`scripts/probe-cache-warming.ts` against `bin/up`). CR-4d turned out to be an FE bug (our
> WS parser dropped the `conversationId` echo on the initial `surface` message) — fixed FE-side.
> Current status lives in `backend-handoff.md` §2. Original report kept below for history.

> **From:** dispatch-web · **To:** arch-rewrite · **Courier:** the user.
> User-reported symptoms, investigated FE-side with a live probe against a running backend
> (`bin/up2` stack, HTTP :25203 / surface WS :25205, 2026-06-12). Repro tool:
> `dispatch-web/scripts/probe-cache-warming.ts` (drives the FE's real WS adapter + the
> `cache-warming` surface; safe to re-run to verify fixes).
>
> **Verdict up front:** the FE renders the surface data faithfully — symptoms 1 and 2 are
> backend data/behavior; symptom 3 needs a new backend affordance (FE will wire it on arrival).

## User-reported symptoms

1. Warming is **ON by default** for a new conversation — the user has to manually turn it off.
   Wanted: default OFF, opt-in per conversation.
2. With warming enabled, **no usable countdown** to the next refresh — the user can't tell
   whether refreshes are happening at all.
3. Wanted lifecycle: refreshes **keep running when the browser window closes** (✅ already true,
   verified — see below), but **closing the conversation's tab in the app should stop the
   refreshes AND abort any in-flight generation** (closing the tab = "done with this chat for now").

## Probe evidence (verbatim observations)

Fresh conversation (first turn sealed), then `subscribe {surfaceId:"cache-warming", conversationId}`:

- **Initial spec:** `toggle value: true`, `number value: 240` (s), timer payload
  `{ nextWarmAt: <now+240s>, lastWarmAt: null }` → **enabled by default, warm already scheduled**.
  Confirms symptom 1 is backend default state.
- `invoke cache-warming/set-interval payload:20` → update with a FUTURE `nextWarmAt` (+20s). ✅
- **Automatic warms DO repeat and DO push updates** — 3 warms observed at ~21s spacing
  (interval 20s), each pushing an `update` with fresh `Last Cache %` / `Cache retention` stats.
  So the engine itself works.
- **BUG (symptom 2 root cause): every post-warm `update` carries a STALE `nextWarmAt` — the fire
  time of the warm that JUST completed (i.e. in the past), never the next scheduled one.**
  Observed sequence (epoch ms):

  | update after | nextWarmAt | lastWarmAt | note |
  |---|---|---|---|
  | warm #1 | 1781246273405 | 1781246274299 | nextWarmAt < lastWarmAt (past) |
  | warm #2 | 1781246294299 | 1781246295269 | = warm#1.lastWarmAt + 20 000 → still past |
  | warm #3 | 1781246315269 | 1781246315998 | = warm#2.lastWarmAt + 20 000 → still past |

  The pattern shows the reschedule math exists (`next = lastWarm + interval`) but the surface
  update is emitted with the PRE-warm snapshot; the post-reschedule (future) `nextWarmAt` is
  never pushed. The FE countdown is authoritative off `nextWarmAt` (per the cache-warming
  handoff design), so after the FIRST automatic warm the UI shows "Next warm in 0s" forever —
  exactly the user's "I can't tell if it's working".
- Same staleness after a real chat turn while subscribed: last update after `turn-sealed` still
  carried a past `nextWarmAt` (−10s and counting), even though a warm was presumably scheduled.
- **Browser-closed continuity ✅:** the schedule is fully server-side — warms fired with no
  browser attached (only the headless probe socket). Symptom 3's "keep running when the window
  closes" half already works; do not regress it.
- **Contract deviation (minor):** the initial `surface` reply to a conversation-scoped subscribe
  does NOT echo `conversationId` (updates do). `ui-contract` says the echo should be present
  ("echoes the subscribe's conversation … so the client routes it"). The FE currently tolerates
  the missing echo (treats no-echo as current), but that weakens stale-scope filtering on fast
  conversation switches — please echo it.

## Asks

### CR-4a — default warming to OFF for a new conversation
New conversations currently start `enabled: true`, interval 240s, first warm scheduled
immediately. Make the default `enabled: false` (no warm scheduled until the user opts in).
No contract change — it's the initial state of the existing surface.

### CR-4b — push the refreshed (future) `nextWarmAt` after each automatic warm
After a warm completes + the next one is scheduled, the emitted surface `update`'s
`cache-warming-timer` payload must carry the NEW future `nextWarmAt` (and the new `lastWarmAt`).
Either emit the update after rescheduling or emit a second update — FE is indifferent; it just
renders the authoritative timestamp. (Same applies to the post-`turn-sealed` reschedule path.)
No contract change — it's the payload of the existing custom field.

### CR-4c — a "conversation closed" affordance (stop warming + abort generation)
The FE needs to tell the backend "the user closed this conversation's tab": that should
(1) disable/stop cache-warming for the conversation and (2) abort any in-flight turn.
Today there is no path:
- `chat.unsubscribe` / socket close explicitly never stops the turn (by design — keep that);
- surface `unsubscribe` doesn't touch the warming schedule (correct for mere disconnects);
- `POST /conversations/:id/cancel` is DEFERRED in `transport-contract`;
- programmatically invoking `cache-warming/toggle` is unsuitable: it FLIPS with no payload, so
  it's racy as an explicit "disable" (and doesn't abort generation).

Preferred shape (backend's call): a single explicit `POST /conversations/:id/close` (or WS
message) that does both, OR un-defer `/cancel` + accept an optional explicit boolean payload on
`cache-warming/toggle`. Whatever ships, the FE wires it into its tab-close path. Note the
asymmetry the user wants: browser/socket disconnect ⇒ warming continues; explicit tab close ⇒
warming + generation stop.

### CR-4d (minor) — echo `conversationId` on the initial `surface` message
Per the `ui-contract` doc comment on `SurfaceMessage` (see deviation above).

## FE-side follow-ups (ours, queued behind the above)
- Harden the countdown display: a past `nextWarmAt` renders as "waiting…" instead of a stuck
  "0s" (cosmetic guard; CR-4b is the real fix).
- On CR-4c shipping: call the close affordance from `store.closeTab()`; re-pin + re-mirror the
  contract; extend `scripts/probe-cache-warming.ts` to verify default-off + post-warm countdown.
