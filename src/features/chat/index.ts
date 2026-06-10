export type { RenderedChunk, RenderGroup, ToolBatchEntry } from "../../core/chunks";
export { groupRenderedChunks } from "../../core/chunks";
export type { TurnMetricsEntry } from "../../core/metrics";
export type { ChatTransport, HistorySync, MetricsSync } from "./ports";
export type { ChatStore, ChatStoreDependencies } from "./store.svelte";
export { createChatStore } from "./store.svelte";
export { default as ChatView } from "./ui/ChatView.svelte";
export { default as Composer } from "./ui/Composer.svelte";
export { default as ModelSelector } from "./ui/ModelSelector.svelte";

/** Public module manifest — aggregated by the shell's "Loaded Modules" view. */
export const manifest = {
	name: "chat",
	description: "Conversation turns, composer, model selector, and metrics",
} as const;
