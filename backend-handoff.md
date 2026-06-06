# Backend handoff — LIVING doc (FE ⇄ backend, couriered by the user)

> **Purpose:** the single rolling document the FE orchestrator keeps current so the user can hand off
> the whole FE↔backend seam at any time — on completion OR at a roadblock. Updated continuously.
> **From:** dispatch-web orchestrator · **To:** arch-rewrite orchestrator · **Courier:** the user.
> `lsp` does NOT span the repos (ORCHESTRATOR §5) — every cross-repo ask flows through here.

_Last updated: 2026-06-06 — Slice 3 (tabs + model selector + DaisyUI) FE-complete; no new backend asks._

---

## 1. Current FE status

| Slice | State |
|---|---|
| **Slice 1** — surface system + WS + composition root | ✅ DONE, committed, green. |
| **Slice 2** — conversation transcript: cache + delta streaming (design §6) | ✅ DONE + **LIVE-VERIFIED** — live e2e probe **9/9** against `bin/up` (see §6). |
| **Slice 3** — tabs (multi-conversation) + model selector + DaisyUI/dracula | ✅ FE-COMPLETE — svelte-check 0/0, **281 vitest**, biome clean, build ok. Per-tab chat stores, one WS routed by `conversationId`, local-forget on tab close, tabs persisted to localStorage. No backend change needed. |

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

### 3.2a Finding — model is NOT persisted/exposed per conversation (FE handled it)
`model` is a per-turn `ChatRequest` field only; `session-orchestrator` resolves it per `handleMessage`
and never stores it, and `conversation-store`/`ConversationHistoryResponse` carry no model. So the FE
**persists the selected model per tab** (localStorage). No action needed. OPTIONAL future nicety: if
you ever persist + expose a per-conversation "last model" (e.g. on the `GET /conversations` list when
it lands), the FE could seed a reopened tab's model from the server instead of localStorage.

### 3.2 FYI — non-blocking gotcha (no action required unless you publish externally)
- **`workspace:*` breaks external `file:` consumption under bun.** `transport-contract`'s deps are
  `@dispatch/ui-contract`/`@dispatch/wire` at `workspace:*`; `bun install` from dispatch-web could not
  resolve them ("Workspace dependency not found"). **Worked around FE-side** with a `package.json`
  `overrides` block mapping both to their `file:` paths — no backend change needed now. If you ever
  publish these to a registry, prefer real semver ranges over `workspace:*` for out-of-monorepo
  consumers.

### 3.3 Pending asks / roadblocks
- _(none open)_ — Slice 2 needed no backend change. One coordination item below (§6).

## 6. LIVE end-to-end probe — DONE ✅ (9/9, against `bin/up`)

Ran `bun scripts/live-probe.ts` (drives the FE's REAL network-facing stack — `adapters/ws` socket,
`core/chunks` reducer, `conversation-cache` + `adapters/idb`, and the HTTP history endpoint — against
the running backend). **All 9 checks passed:**
- one WS (`:24205`) delivered the surface `catalog` AND the chat stream;
- `chat.send` → ~33 `chat.delta` events (incl. `text-delta`) → folded to the expected assistant text
  → `turn-sealed`;
- post-seal `GET :24203/conversations/:id?sinceSeq=0` → 3 seq-monotonic `StoredChunk`s
  (`latestSeq=3`); `applyHistory` superseded the provisional turn (`sealedTurnId` cleared);
- IndexedDB cache persisted the sealed turn; committed transcript shows the assistant text.

**No backend mismatch found — every confirmed invariant (C1–C4) held live.** One FE-internal note
(not a backend matter): the idb adapter relies on the global `IDBKeyRange` (fine in a browser; the
probe needed `fake-indexeddb/auto` to supply it under Bun).

Also caught + fixed during browser bring-up (FE-only bug, not backend): a BLANK page on plain-HTTP
non-localhost origins (`http://arch-razer:24204`) because `crypto.randomUUID()` is secure-context-only
— now replaced with a `getRandomValues`-based fallback.

## 4. (history) Slice 2 unit map — delivered, see §1.

## 5. Likely NEXT backend asks (heads-up, not yet requested)

These belong to **later** FE slices (design §7 "later slice") — flagged early so they're on your radar:
- `GET /conversations` — conversation list / sidebar (FE history explorer / conversation switcher).
- `POST /conversations/:id/cancel` — "stop generating".

When the FE reaches those slices, the concrete request will be filed here in §3.3.
