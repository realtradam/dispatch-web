# Glossary — canonical vocabulary (dispatch-web)

> One name per concept. Shared backend terms are adopted VERBATIM (no drift).
> New term? The orchestrator proposes the standard name and the user confirms
> before it lands (§5.6). "Aliases to avoid" maps wrong names back to the canonical.

## Shared with the backend (canonical — do NOT redefine)
| Term | Meaning | Aliases to avoid |
|---|---|---|
| **conversation** | A single thread of turns with persisted history, id'd by `conversationId`. | session, thread, chat (and do NOT call the conversation itself a "tab" — a tab *references* one; see FE "tab") |
| **conversationId** | The string id threading multi-turn history. | tabId, sessionId, chatId |
| **turn** | One user message → assistant response cycle (may span steps). | — |
| **step** | One LLM round-trip within a turn. | iteration |
| **chunk** | One ordered piece of a message (text/thinking/tool-call/result), append-only. | block, segment |
| **AgentEvent** | An outward event the runtime emits during a turn (text-delta, tool-call, usage, done, turn-sealed, …). | — |
| **model name** | The selectable id in `<credentialName>/<model>` form. | model id, model reference |
| **model catalog** | The list of available model names. | model list |
| **turn metrics** | The durable, replayable per-turn metrics record for a sealed turn: aggregate `Usage` (tokens) + turn `durationMs` + its per-step `StepMetrics` (`TurnMetrics`). Persisted backend-side keyed by `turnId`, served by `GET /conversations/:id/metrics`. The persisted counterpart of the live `done` event's metrics; the FE folds the SAME shape from the live `usage`/`step-complete`/`done` events for the in-flight turn. | usage record, turn stats |
| **step metrics** | The durable per-step metrics within a `TurnMetrics`: the step's `Usage` (tokens) + `ttftMs`/`decodeMs`/`genTotalMs` timing, keyed by `stepId` (`StepMetrics`). The persisted counterpart of the live `usage` + `step-complete` events. | step stats |
| **TTFT** (time to first token) | Per-step latency: generation stream start → first content token (text or reasoning). One per step (each step re-prefills). On the wire as `step-complete.ttftMs` / `StepMetrics.ttftMs` (optional). | time-to-first-byte |
| **decode time** | Per-step generation time after the first token (first token → stream end = `genTotalMs − ttftMs`). On the wire as `step-complete.decodeMs` / `StepMetrics.decodeMs` (optional). | — |
| **context size** | The tokens a conversation currently occupies: the most recent turn's FINAL step `inputTokens + outputTokens` (NOT the aggregate per-turn `usage`, which sums per-step prompts and overcounts a multi-step turn). On the wire as `TurnDoneEvent.contextSize` (live `done`) + `TurnMetrics.contextSize` (persisted); the FE reads the LATEST turn's value as current usage, and treats `undefined` as "unknown" (renders a placeholder, never `0`). Mirrors the backend GLOSSARY. | context usage, context length, tokens used (and do NOT call it "context window" — that's the limit) |
| **reasoning effort** | The per-request thinking-depth knob: how much extended thinking the model spends before answering. Canonical ladder `ReasoningEffort = "low" \| "medium" \| "high" \| "xhigh" \| "max"` (`wire@0.7.0`). Resolution is SERVER-owned (never re-implement): per-turn `ChatRequest.reasoningEffort` override → persisted per-conversation value (`GET`/`PUT /conversations/:id/reasoning-effort`) → default `"high"` — so `null` from the GET means "default (`high`) applies", not "off". Changing the level can bust the prompt cache for the next turn (one-time re-prefill); a stable setting stays cache-safe. | thinking setting, thinking level, effort level, thinking budget |
| **context window** | The model's MAXIMUM token capacity (the limit a **context size** is measured against). A FUTURE backend field — not on the wire yet. **Placeholder:** the composer status bar currently HARDCODES a `1,000,000`-token window for the `size / limit · pct%` readout + fill bar; swap to the real per-model value when the backend ships it (see `backend-handoff.md` §3). | max context, token limit (distinct from **context size**, the current usage) |

## Frontend-specific
| Term | Meaning | Aliases to avoid |
|---|---|---|
| **surface** | A backend-declared, frontend-agnostic data contribution (fields + values + actions); rendered generically by any client. NOT UI/styling. | widget, panel-data |
| **region** | Where a surface mounts — a coarse, semantic placement hint (NOT layout/CSS). | slot (clashes with Svelte `<slot>`) |
| **field kind** | The semantic type of a surface field (toggle/progress/selector/stat/button/custom). | widget type, control type |
| **action / action ref** | A backend-invokable action; a field carries an *action ref* the client posts back. (Backend calls this a `command` for now.) | — |
| **surface catalog** | The list of available surfaces (metadata) the FE fetches to discover them (`GET /surfaces`). | capability manifest |
| **view** | RESERVED — the old-Dispatch sidebar affordance (settings / feature views); a FUTURE FE concept, NOT a surface. | (do not reuse) |
| **tab** | A FE workspace slot in the tab strip that *references* one open conversation — holds its `conversationId`, the selected **model name**, and a derived title. Distinct from the conversation itself (the backend thread): closing a tab forgets it LOCALLY (drops the slot + evicts its FE cache); the conversation persists server-side. Open tabs + the active tab are persisted locally. | (do not conflate with **conversation**) |
| **feature module** | A self-contained FE feature (chat, history explorer, …); feature-as-a-library, composed at the root. | — |
| **composition root** | The single place (`src/app/`) that imports + wires feature modules + the surface host. | — |
| **surface interpreter** | The generic renderer: field kind → component. Knows kinds, never surface ids. | — |
| **metrics bubble** | The FE chat element that renders a turn's **turn metrics** (one per-turn total) and **step metrics** (one per step) as muted system-style bubbles at a turn's tail. UI presentation of `TurnMetrics`/`StepMetrics`; never a surface. | telemetry bubble, usage bubble, stats bubble |
| **TPS** (tokens per second) | A FE-DERIVED decode rate: `outputTokens / (decodeMs / 1000)` (per step; per turn over Σ `decodeMs`), falling back to `genTotalMs` when `decodeMs` is absent. The backend-recommended basis (excludes first-token latency). Not carried on the wire; omitted when timing is absent. | throughput |
| **chat limit** | The max LOADED chunks per conversation (default 256; localStorage `dispatch.chatLimit`, no UI yet) before the oldest quarter is unloaded. Counts **chunks** (committed + provisional + accumulating). Policy in `core/chunks/trim.ts`. | chunk limit, message limit, history limit |
| **unload** | Drop the oldest COMMITTED chunks from the in-memory transcript (and DOM) past the **chat limit** — in BULK (`ceil(limit/4)` per pass, deferred while the reader is scrolled up), never one-per-delta (old Dispatch's scroll-jump bug). Purely local: the IndexedDB cache and the server keep everything; `TranscriptState.hiddenBeforeSeq` is the watermark. Distinct from the conversation-cache's cross-conversation **eviction**. | evict (reserved for the cross-conversation cache), prune, drop |
| **show earlier** | The affordance at the top of a transcript with unloaded history ("Show earlier messages"): pages one unload-unit back in — local cache first, then the server (CR-5 `?beforeSeq=&limit=`) when the cache doesn't reach far enough back — preserving the reader's scroll position. Offered whenever the loaded window starts above seq 1 (the wire@0.6.1 1-based gap-free seq contract). | load more, pagination |
