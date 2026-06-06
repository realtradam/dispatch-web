# Backend handoff — LIVING doc (FE ⇄ backend, couriered by the user)

> **Purpose:** the single rolling document the FE orchestrator keeps current so the user can hand off
> the whole FE↔backend seam at any time — on completion OR at a roadblock. Updated continuously.
> **From:** dispatch-web orchestrator · **To:** arch-rewrite orchestrator · **Courier:** the user.
> `lsp` does NOT span the repos (ORCHESTRATOR §5) — every cross-repo ask flows through here.

_Last updated: 2026-06-06 — Slice 2 kicked off (unit summons in flight)._

---

## 1. Current FE status

| Slice | State |
|---|---|
| **Slice 1** — surface system + WS + composition root | ✅ DONE, committed, green (svelte-check 0/0, 91 vitest, biome clean, build ok). |
| **Slice 2** — conversation transcript: cache + delta streaming (design §6) | 🔧 IN PROGRESS — contracts pinned + mirrored; FE units being built (see §4). |

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
- _(none open)_ — Slice 2 has all the backend contracts it needs.

## 4. Looking ahead — FE Slice 2 unit map (no backend dependency)

Pure-core / injected-shell decomposition, built by single-owner agents in this repo:
`core/chunks` (the one transcript reducer) · `core/wire` (contract-conformance type-tests) ·
`adapters/ws` (extend for `chat.send`/`chat.delta`) · `features/conversation-cache`
(pure `reconcileCache`/`selectEvictions` + IndexedDB port) · `adapters/idb` (IndexedDB impl) ·
`features/chat` (view-model + UI) · `app` (wiring). None require backend changes.

## 5. Likely NEXT backend asks (heads-up, not yet requested)

These belong to **later** FE slices (design §7 "later slice") — flagged early so they're on your radar:
- `GET /conversations` — conversation list / sidebar (FE history explorer / conversation switcher).
- `POST /conversations/:id/cancel` — "stop generating".

When the FE reaches those slices, the concrete request will be filed here in §3.3.
