export type { WarmFeedback, WarmNow } from "./logic/view-model";
export { default as CacheWarmingView } from "./ui/CacheWarmingView.svelte";

/** Public module manifest — aggregated by the shell's "Loaded Modules" view. */
export const manifest = {
	name: "cache-warming",
	description: "Prompt-cache warming controls, history, and countdown",
} as const;
