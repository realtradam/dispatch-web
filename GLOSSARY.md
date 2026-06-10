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
