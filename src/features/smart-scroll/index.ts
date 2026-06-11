export type {
	ScrollCommand,
	ScrollGeometry,
	SmartScrollResult,
	SmartScrollState,
} from "./logic/smart-scroll";
export {
	createSmartScrollState,
	isNearBottom,
	NEAR_BOTTOM_THRESHOLD,
	onContentChange,
	onReset,
	onResume,
	onScroll,
} from "./logic/smart-scroll";
export type { SmartScrollController } from "./ui/controller.svelte";
export { createSmartScrollController } from "./ui/controller.svelte";
export { default as ScrollToBottom } from "./ui/ScrollToBottom.svelte";

/** Public module manifest — aggregated by the shell's "Loaded Modules" view. */
export const manifest = {
	name: "smart-scroll",
	description:
		"Keeps the transcript pinned to the bottom while it streams, unless the reader scrolls up",
} as const;
