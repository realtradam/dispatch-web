# Backend handoff — LIVING doc (FE ⇄ backend, couriered by the user)

> **Purpose:** the single rolling document the FE orchestrator keeps current so the user can hand off
> the whole FE↔backend seam at any time — on completion OR at a roadblock. Updated continuously.
> **From:** dispatch-web orchestrator · **To:** arch-rewrite orchestrator · **Courier:** the user.
> `lsp` does NOT span the repos (ORCHESTRATOR §5) — every cross-repo ask flows through here.

_Last updated: 2026-06-10 — metrics display slice FE-complete + live-verified (probe 17/17). No open backend asks._

---

## 1. Pinned backend contracts (consumed by the FE)

Pinned as `file:` deps: **`ui-contract@0.1.0`; `wire@0.4.0`; `transport-contract@0.4.0`**.

| Package | Used for |
|---|---|
| `@dispatch/ui-contract` | surfaces + surface WS protocol |
| `@dispatch/wire` | `Chunk`/`StoredChunk`(+`seq`)/`ChatMessage`/`AgentEvent`/`TurnSealedEvent`/`Usage`/`StepId` + metrics: `StepMetrics`/`TurnMetrics`, `usage.stepId`, `step-complete`, `done.durationMs`/`done.usage`, `tool-result.durationMs` |
| `@dispatch/transport-contract` | `ChatRequest`/`ModelsResponse`/`ConversationHistoryResponse`/`ConversationMetricsResponse` + WS chat ops + `WsClientMessage`/`WsServerMessage` |

Endpoints in use (HTTP **24203**, WS **24205**, CORS `*`):
`POST /chat` (NDJSON) · `GET /models` · `GET /conversations/:id?sinceSeq=<n>` ·
`GET /conversations/:id/metrics` · WS `chat.send`→`chat.delta`.

Mirrored in-repo for headless agents: `.dispatch/{ui-contract,wire,transport-contract}.reference.md`
(regenerate on any contract bump).

## 2. Open asks FOR THE BACKEND

- _(none open)_

## 3. Likely NEXT backend asks (heads-up, not yet requested)

- `GET /conversations` — conversation list / sidebar (history explorer / switcher); could also expose a
  per-conversation "last model" so a reopened tab seeds its model from the server instead of localStorage.
- `POST /conversations/:id/cancel` — "stop generating".
