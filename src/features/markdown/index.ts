export { renderMarkdown } from "./logic/markdown";
export { default as Markdown } from "./ui/Markdown.svelte";

/** Public module manifest — aggregated by the shell's "Loaded Modules" view. */
export const manifest = {
	name: "markdown",
	description: "Renders assistant messages as sanitized Markdown (GFM + syntax highlighting)",
} as const;
