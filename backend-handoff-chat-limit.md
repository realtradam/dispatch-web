# Backend handoff — CR-5: history windowing for the FE chat limit (courier doc)

> **From:** dispatch-web · **To:** arch-rewrite · **Courier:** the user.
> Companion to the living `backend-handoff.md` (§2 CR-5). 2026-06-12.

## Context — what the FE is building (no backend blocker)

The FE is adding a **chat limit**: in very long conversations the transcript unloads old
chunks from memory/DOM so the browser stays fast. Policy (already decided with the user):

- Limit `L` counts **chunks** (default 256, localStorage-configurable).
- When the loaded count exceeds `L`, the FE unloads the oldest `ceil(L/4)` chunks in ONE
  bulk pass (e.g. `L=100`: at 101 chunks it unloads 25 → 76 remain). Bulk-on-threshold —
  NOT one-per-delta like old Dispatch — to kill the scroll-jump-per-step failure mode.
- A fresh page load shows only the newest `floor(0.75 × L)` chunks (192 for the default).
- A "Show earlier messages" affordance pages older history back in (today: from the FE's
  IndexedDB cache, which still holds it).

**This works TODAY with no backend change** — the FE fetches everything and windows in
memory. The ask below makes the *fresh-browser* case cheap: with an empty IndexedDB cache,
`GET /conversations/:id?sinceSeq=0` currently returns the ENTIRE conversation, so a
10k-chunk chat downloads + parses megabytes only for the FE to display 192 chunks.

## The ask (additive, `transport-contract` bump)

Extend `GET /conversations/:id` with two OPTIONAL query params:

1. **`limit=<n>`** — return only the **newest** `n` chunks of the selection (still
   ascending seq order in the response). Selection semantics otherwise unchanged
   (`seq > sinceSeq`).
   - **If the selection has ≤ `n` chunks, return everything** — the FE will routinely send
     a largish number (e.g. `limit=192`) against short conversations and expects the
     normal full response (that flow must stay cheap and exact).
   - `limit` absent → exactly today's behavior (full selection). Existing FE versions keep
     working unchanged.
2. **`beforeSeq=<s>`** — restrict the selection to `seq < s` (combined with `limit`: the
   newest `n` chunks below `s`, ascending). This is the "Show earlier messages" page-in
   path for history the FE's local cache doesn't have (e.g. a fresh browser that
   initial-loaded with `limit`). `beforeSeq` + `sinceSeq` together = `sinceSeq < seq < s`
   (we only ever send one of them, but defined semantics beat undefined).

And one additive response field on `ConversationHistoryResponse`:

3. **`earliestSeq?: number`** (or `hasOlder: boolean` — your pick, flag your choice in the
   reply) — the conversation's overall lowest seq (or whether chunks exist below the
   returned window). The FE needs to know whether to OFFER "Show earlier messages" when
   its local cache is exhausted. Without it the FE can only guess (seq 1 = start works if
   seqs are guaranteed to start at 1 and be gap-free — if you'd rather just CONFIRM that
   invariant in writing, the FE can derive `hasOlder` from `chunks[0].seq > 1` and we skip
   the new field entirely; cheapest option, totally fine).

## How the FE will consume it

- Fresh load (empty cache): `GET /conversations/:id?sinceSeq=0&limit=<floor(0.75×L)>`.
- Incremental tail sync (cache warm): unchanged `?sinceSeq=<maxCachedSeq>` (no limit — the
  tail since last sync is small by construction).
- Show-earlier beyond local cache: `GET /conversations/:id?beforeSeq=<oldestLoadedSeq>&limit=<ceil(L/4)>`.
- The FE's IndexedDB cache is seq-keyed + dedup-by-seq and already tolerates a
  non-contiguous prefix (a windowed suffix), so no cache-format change is needed FE-side.

## Priority / sequencing

Not a blocker — the FE ships the limit feature against the current contract (full fetch +
in-memory windowing) and lights up the `limit`/`beforeSeq` params when you ship. Ship
whenever convenient; please bump `transport-contract` and note the params in the reply
handoff so the FE re-pins + re-mirrors.
