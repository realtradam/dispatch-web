# Backend handoff — LIVING doc (FE ⇄ backend, couriered by the user)

> **Purpose:** the single rolling document the FE orchestrator keeps current so the user can hand off
> the whole FE↔backend seam at any time — on completion OR at a roadblock. Updated continuously.
> **From:** dispatch-web orchestrator · **To:** arch-rewrite orchestrator · **Courier:** the user.
> `lsp` does NOT span the repos (ORCHESTRATOR §5) — every cross-repo ask flows through here.

_Last updated: 2026-06-06 — Slice 2 FE-complete (unit + integration green); awaiting a LIVE probe._

---

## 1. Current FE status

| Slice | State |
|---|---|
| **Slice 1** — surface system + WS + composition root | ✅ DONE, committed, green. |
| **Slice 2** — conversation transcript: cache + delta streaming (design §6) | ✅ FE-COMPLETE, committed — svelte-check 0/0, **218 vitest** (stable x2), biome clean, build ok. **Not yet live-probed against a running backend** (see §6). |

**Slice 2 units built** (all pure-core / injected-shell, single-owner): `core/chunks` (the one
transcript reducer) · `core/wire` (contract-conformance drift guard) · `adapters/ws` (now multiplexes
`chat.send`/`chat.delta` on the one socket) · `features/conversation-cache` (pure reconcile/evict +
`ConversationChunkStore` port) · `adapters/idb` (IndexedDB impl) · `features/chat` (runes view-model
+ `ChatView`/`Composer`) · `app` (one socket for surface+chat, host-relative HTTP `:24203` history
sync, IndexedDB cache, renders the chat). Consumes ONLY the pinned `@0.1.0` contracts — no backend
change was needed.

## 2. Pinned backend contracts (consumed by the FE)

All three pinned as `file:` deps at **`@0.1.0`** and live-verified consumable (import smoke-test passes):

| Package | Used for |
|---|---|
| `@dispatch/ui-contract` | surfaces + surface WS protocol (Slice 1) |
| `@dispatch/wire` | chat wire types: `Chunk`/`StoredChunk`(+`seq`)/`ChatMessage`/`AgentEvent`/`TurnSealedEvent`/`Usage` |
| `@dispatch/transport-contract` | HTTP endpoints + `ChatRequest`/`ModelsResponse`/`ConversationHistoryResponse` + WS chat ops + unified `WsClientMessage`/`WsServerMessage` |

Backend endpoints in use (port **24203** HTTP, **24205** WS, CORS wildcard `*` — all confirmed live):
`POST /chat` (NDJSON), `GET /models`, `GET /conversations/:id?sinceSeq=<n>`, WS `chat.send`→`chat.delta`.
Confirmed invariants C1–C4 (raw seq-ordered history slice · one path-agnostic WS multiplexing surface+chat · `turn-sealed` fires post-persist = cache-commit · live deltas carry no `seq`).

Mirrored in-repo for headless agents: `.dispatch/ui-contract.reference.md`, `.dispatch/wire.reference.md`,
`.dispatch/transport-contract.reference.md` (regenerated on any contract bump).

## 3. Open items FOR THE BACKEND

### 3.1 Resolved / answered
- ✅ Wire-types split, per-chunk `seq`, history endpoint, WS chat multiplexing, CORS — all delivered
  (backend commit `812621c`).

### 3.2 FYI — non-blocking gotcha (no action required unless you publish externally)
- **`workspace:*` breaks external `file:` consumption under bun.** `transport-contract`'s deps are
  `@dispatch/ui-contract`/`@dispatch/wire` at `workspace:*`; `bun install` from dispatch-web could not
  resolve them ("Workspace dependency not found"). **Worked around FE-side** with a `package.json`
  `overrides` block mapping both to their `file:` paths — no backend change needed now. If you ever
  publish these to a registry, prefer real semver ranges over `workspace:*` for out-of-monorepo
  consumers.

### 3.3 Pending asks / roadblocks
- _(none open)_ — Slice 2 needed no backend change. One coordination item below (§6).

## 6. Recommended next: a LIVE end-to-end probe (coordination, not a change)

Slice 2 is unit/integration-green, but per the Slice-1 lesson (an effectful transport SHELL is
exactly where integration bugs hide — the WS-upgrade bug only surfaced live), the FE chat path should
be probed against a **running backend** before we call it done:
- WS `chat.send` → `chat.delta` stream over `:24205`, and the post-`turn-sealed` resync via
  `GET /conversations/:id?sinceSeq` over `:24203` (CORS from the `:24204` page origin).
- FE expectations being validated: one socket multiplexes surface + chat; deltas fold into a
  provisional turn; on `turn-sealed` the FE refetches `?sinceSeq` and the authoritative seq'd chunks
  supersede the provisional ones; IndexedDB caches sealed turns.

**Ask to the backend orchestrator (via courier):** confirm a known-good local boot (`bin/up`?) with
the HTTP `:24203` + WS `:24205` servers both up, and — if convenient — a minimal scripted chat turn
we can point the FE dev server (`bun run dev`, `:24204`) at. The FE can drive the probe from the
browser; we just need the backend running with a real model credential. Report any shape/behaviour
mismatch back here in §3.3.

## 4. (history) Slice 2 unit map — delivered, see §1.

## 5. Likely NEXT backend asks (heads-up, not yet requested)

These belong to **later** FE slices (design §7 "later slice") — flagged early so they're on your radar:
- `GET /conversations` — conversation list / sidebar (FE history explorer / conversation switcher).
- `POST /conversations/:id/cancel` — "stop generating".

When the FE reaches those slices, the concrete request will be filed here in §3.3.
