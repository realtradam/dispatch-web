# `@dispatch/wire` — in-repo reference (read THIS, not node_modules)

> MIRRORS the backend's `@dispatch/wire` package source so headless FE agents can read the wire
> types WITHOUT following the `file:` dep symlink out of this repo (which hangs on a permission
> prompt). Your CODE still imports `@dispatch/wire` normally — this file is for READING only.
>
> **Orchestrator:** SNAPSHOT of `wire@0.3.0`. Regenerate whenever `@dispatch/wire` changes.
>
> **0.3.0 change (live metrics — see `frontend-metrics-handoff.md` for the full guide):** new
> `TurnStepCompleteEvent` (`type:"step-complete"`) in the `AgentEvent` union with per-step
> `ttftMs?`/`decodeMs?`/`genTotalMs?`; `TurnUsageEvent` gained `stepId?`; `TurnToolResultEvent`
> gained `durationMs?` (tool exec time); `TurnDoneEvent` gained `durationMs?` (turn wall-clock) +
> `usage?` (turn total). All additive/optional — existing handling is unaffected. (0.2.0 added
> `stepId` for tool-call grouping.)

```ts
/**
 * @dispatch/wire — pure wire types shared by the kernel, the transport
 * contract, and out-of-repo clients (the web frontend).
 *
 * Types ONLY: zero runtime, zero `@dispatch/*` dependencies, so a client can
 * depend on the wire without pulling the kernel runtime.
 */

// ─── Conversation model ─────────────────────────────────────────────────────

/** Who produced a message. */
export type Role = "system" | "user" | "assistant" | "tool";

/** Opaque identifier for a turn (one user→assistant cycle). */
export type TurnId = string & { readonly __brand: "TurnId" };

/**
 * Opaque identifier for a step (one LLM round-trip within a turn). It is the
 * authoritative grouping key for the tool calls a model batches together in a
 * single step (parallel/batched calls): every `tool-call`/`tool-result` event
 * and every persisted tool chunk (`ToolCallChunk`/`ToolResultChunk`) from the
 * same step carries the SAME `stepId`, so a client groups a batch purely by
 * equality — identically on the live stream and in replayed history. Per-turn
 * unique and gap-free in step order; treat it as opaque (do not parse it). The
 * runtime derives it deterministically from the turn id + 0-based step index.
 */
export type StepId = string & { readonly __brand: "StepId" };

/**
 * A chunk is one ordered piece of a message — the atomic unit of the
 * append-only conversation log. Discriminated by `type`.
 */
export type Chunk =
	| TextChunk
	| ThinkingChunk
	| ToolCallChunk
	| ToolResultChunk
	| ErrorChunk
	| SystemChunk;

/** A piece of plain text content from the assistant or user. */
export interface TextChunk {
	readonly type: "text";
	readonly text: string;
}

/** A piece of model reasoning / thinking content (e.g. extended thinking). */
export interface ThinkingChunk {
	readonly type: "thinking";
	readonly text: string;
}

/**
 * A model's request to run a tool. The kernel routes by `name`; the tool
 * implementation never sees this directly — it receives parsed `input` via
 * `ToolContract.execute`.
 */
export interface ToolCallChunk {
	readonly type: "tool-call";
	readonly toolCallId: string;
	readonly toolName: string;
	readonly input: unknown;
	/** Step grouping key (generation provenance). Optional — tolerate absence. */
	readonly stepId?: StepId;
}

/**
 * The result of a tool execution, attributed to the originating tool-call id.
 * The kernel guarantees every tool-call chunk gets exactly one result chunk
 * (synthesized if interrupted — see reconcile).
 */
export interface ToolResultChunk {
	readonly type: "tool-result";
	readonly toolCallId: string;
	readonly toolName: string;
	readonly content: string;
	readonly isError: boolean;
	/** Step grouping key — equals the originating call's. Optional. */
	readonly stepId?: StepId;
}

/** An error that occurred during generation or tool dispatch. */
export interface ErrorChunk {
	readonly type: "error";
	readonly message: string;
	readonly code?: string;
}

/**
 * A system-injected message (e.g. system prompt, context assembly output).
 * Kept distinct from text so the log records provenance.
 */
export interface SystemChunk {
	readonly type: "system";
	readonly text: string;
}

/**
 * A chat message: a role plus an ordered sequence of chunks. Messages are the
 * unit passed to and from the provider; chunks are the unit persisted and
 * rendered.
 */
export interface ChatMessage {
	readonly role: Role;
	readonly chunks: readonly Chunk[];
}

/**
 * A persisted chunk plus its sync metadata: `{ seq, role, chunk }`. `seq` is the
 * per-conversation sync cursor (envelope); a tool chunk's `stepId` rides on
 * `chunk` (generation provenance). NOTE: usage/timing metrics are NOT persisted —
 * they exist only on the live stream (see `frontend-metrics-handoff.md`).
 */
export interface StoredChunk {
	readonly seq: number;
	readonly role: Role;
	readonly chunk: Chunk;
}

// ─── Usage ──────────────────────────────────────────────────────────────────

/**
 * Token usage counters for a single step. All fields are counts of tokens.
 * Cache fields are optional because not all providers expose cache metrics.
 */
export interface Usage {
	readonly inputTokens: number;
	readonly outputTokens: number;
	readonly cacheReadTokens?: number;
	readonly cacheWriteTokens?: number;
}

// ─── Outward events ─────────────────────────────────────────────────────────

/**
 * The union of all events the runtime emits outward during a turn.
 * Consumers (transport, persistence, notifications) pattern-match on `type`.
 */
export type AgentEvent =
	| StatusEvent
	| TurnStartEvent
	| TurnTextDeltaEvent
	| TurnReasoningDeltaEvent
	| TurnToolCallEvent
	| TurnToolResultEvent
	| TurnToolOutputEvent
	| TurnUsageEvent
	| TurnStepCompleteEvent
	| TurnErrorEvent
	| TurnDoneEvent
	| TurnSealedEvent;

/** Status change for a conversation (e.g. idle → running). */
export interface StatusEvent {
	readonly type: "status";
	readonly conversationId: string;
	readonly status: string;
}

/** A turn has begun. */
export interface TurnStartEvent {
	readonly type: "turn-start";
	readonly conversationId: string;
	readonly turnId: string;
}

/** Incremental text content from the model during a turn. */
export interface TurnTextDeltaEvent {
	readonly type: "text-delta";
	readonly conversationId: string;
	readonly turnId: string;
	readonly delta: string;
}

/** Incremental reasoning / thinking content during a turn. */
export interface TurnReasoningDeltaEvent {
	readonly type: "reasoning-delta";
	readonly conversationId: string;
	readonly turnId: string;
	readonly delta: string;
}

/** The model has requested a tool to be run. */
export interface TurnToolCallEvent {
	readonly type: "tool-call";
	readonly conversationId: string;
	readonly turnId: string;
	/** Step grouping key (matches the tool-result event + persisted chunk). */
	readonly stepId: StepId;
	readonly toolCallId: string;
	readonly toolName: string;
	readonly input: unknown;
}

/** A tool has completed execution. */
export interface TurnToolResultEvent {
	readonly type: "tool-result";
	readonly conversationId: string;
	readonly turnId: string;
	/** Step grouping key — equals the matching tool-call's. */
	readonly stepId: StepId;
	readonly toolCallId: string;
	readonly toolName: string;
	readonly content: string;
	readonly isError: boolean;
	/**
	 * How long the tool took to execute (dispatch → result), in milliseconds —
	 * the backend's authoritative execution time, distinct from any client-side
	 * wall-clock. Optional: present only when the runtime was given a clock.
	 */
	readonly durationMs?: number;
}

/** Streaming output from a tool execution (e.g. shell stdout/stderr). */
export interface TurnToolOutputEvent {
	readonly type: "tool-output";
	readonly conversationId: string;
	readonly turnId: string;
	readonly toolCallId: string;
	readonly data: string;
	readonly stream: "stdout" | "stderr";
}

/** Token usage for the current step or turn. */
export interface TurnUsageEvent {
	readonly type: "usage";
	readonly conversationId: string;
	readonly turnId: string;
	/**
	 * The step this usage report belongs to, so a consumer can attribute tokens
	 * per step (and join with the matching `step-complete` timing by `stepId`).
	 * Optional: absent when the runtime had no step context.
	 */
	readonly stepId?: StepId;
	readonly usage: Usage;
}

/**
 * A step (one LLM round-trip) has completed — the authoritative per-step metrics
 * packet, emitted once at the step's end (after the generation stream finishes),
 * so its timing is final (unlike `usage`, which may arrive mid-stream). Carries
 * the step's generation timing; join to the step's tokens via `stepId` on the
 * `usage` event. All timing fields are optional: present only when the runtime
 * was given a clock, and `ttftMs`/`decodeMs` additionally require that a first
 * content token (text or reasoning) was observed this step.
 */
export interface TurnStepCompleteEvent {
	readonly type: "step-complete";
	readonly conversationId: string;
	readonly turnId: string;
	readonly stepId: StepId;
	/** Time to first token: stream start → first text/reasoning delta. */
	readonly ttftMs?: number;
	/** Decode time: first token → stream end (generation total − TTFT). */
	readonly decodeMs?: number;
	/**
	 * Total generation time for the step: stream start → stream end. Present
	 * whenever a clock was available, even if no first token was seen (then
	 * `ttftMs`/`decodeMs` are absent). When a first token was seen,
	 * `genTotalMs === ttftMs + decodeMs`.
	 */
	readonly genTotalMs?: number;
}

/** An error occurred during the turn. */
export interface TurnErrorEvent {
	readonly type: "error";
	readonly conversationId: string;
	readonly turnId: string;
	readonly message: string;
	readonly code?: string;
}

/** The turn has completed (model finished generating). */
export interface TurnDoneEvent {
	readonly type: "done";
	readonly conversationId: string;
	readonly turnId: string;
	readonly reason: string;
	/**
	 * Total wall-clock duration of the turn (turn start → turn end), in
	 * milliseconds. Optional: present only when the runtime was given a clock.
	 */
	readonly durationMs?: number;
	/**
	 * Aggregate token usage across all steps in the turn — a convenience total so
	 * a consumer need not sum the per-step `usage` events. Optional.
	 */
	readonly usage?: Usage;
}

/**
 * The turn has been sealed — all chunks persisted, history is final.
 * This is the hook point for post-turn extensions (compaction, cache-warm).
 */
export interface TurnSealedEvent {
	readonly type: "turn-sealed";
	readonly conversationId: string;
	readonly turnId: string;
}
```
