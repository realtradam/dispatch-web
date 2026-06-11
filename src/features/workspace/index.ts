export type {
	CwdSaveResult,
	LoadLspStatus,
	LspStatusResult,
	SaveCwd,
} from "./logic/view-model";
export { default as CwdField } from "./ui/CwdField.svelte";
export { default as LspStatusView } from "./ui/LspStatusView.svelte";

/** Public module manifest — aggregated by the shell's "Loaded Modules" view. */
export const manifest = {
	name: "workspace",
	description: "Per-conversation working directory + language-server status",
} as const;
