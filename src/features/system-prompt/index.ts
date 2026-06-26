export type {
	LoadSystemPrompt,
	LoadSystemPromptVariables,
	SaveSystemPrompt,
	SystemPromptLoadResult,
	SystemPromptSaveResult,
	SystemPromptVariablesResult,
	VariableGroup,
} from "./logic/view-model";
export { buildTag, groupVariables, insertTag, isDynamicVariable } from "./logic/view-model";
export { default as SystemPromptBuilder } from "./ui/SystemPromptBuilder.svelte";

/** Public module manifest — aggregated by the shell's "Loaded Modules" view. */
export const manifest = {
	name: "system-prompt",
	description: "Global system prompt template builder with variable placeholders",
} as const;
