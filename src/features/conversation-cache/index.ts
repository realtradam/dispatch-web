export type { ConversationCache, ConversationCacheOptions } from "./cache";
export { createConversationCache } from "./cache";
export { nextSinceSeq, reconcileCache, selectEvictions } from "./logic";
export type {
	ConversationCacheIndexEntry,
	ConversationChunkStore,
	ReconcileResult,
} from "./types";

/** Public module manifest — aggregated by the shell's "Loaded Modules" view. */
export const manifest = {
	name: "conversation-cache",
	description: "IndexedDB-backed chunk cache with reconciliation",
} as const;
