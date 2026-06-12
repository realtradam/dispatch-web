export type { RenderedChunk, RenderGroup, ToolBatchEntry } from "../../core/chunks";
export { groupRenderedChunks } from "../../core/chunks";
export type { TurnMetricsEntry } from "../../core/metrics";
export type { ChatTransport, HistorySync, HistoryWindow, MetricsSync } from "./ports";
export type {
	EffortOption,
	ReasoningEffortSaveResult,
	SaveReasoningEffort,
} from "./reasoning-effort";
export {
	DEFAULT_REASONING_EFFORT,
	effectiveEffort,
	effortOptions,
	isReasoningEffort,
	REASONING_EFFORT_LEVELS,
} from "./reasoning-effort";
export type { ChatStore, ChatStoreDependencies } from "./store.svelte";
export { createChatStore } from "./store.svelte";
export { default as ChatView } from "./ui/ChatView.svelte";
export { default as Composer } from "./ui/Composer.svelte";
export { default as ModelSelector } from "./ui/ModelSelector.svelte";
export { default as ReasoningEffortSelector } from "./ui/ReasoningEffortSelector.svelte";

/** Public module manifest — aggregated by the shell's "Loaded Modules" view. */
export const manifest = {
	name: "chat",
	description: "Conversation turns, composer, model selector, and metrics",
} as const;
