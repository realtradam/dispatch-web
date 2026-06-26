export type {
	HeartbeatConfig,
	HeartbeatConfigPatch,
	HeartbeatConfigResult,
	HeartbeatNextRunResult,
	HeartbeatRun,
	HeartbeatRunStatus,
	HeartbeatRunsResult,
	HeartbeatStopResult,
	LoadHeartbeatConfig,
	LoadHeartbeatNextRun,
	LoadHeartbeatRuns,
	SaveHeartbeatConfig,
	StopHeartbeatRun,
} from "./logic/types";
export type { Badge, HeartbeatFormState, HeartbeatRunView } from "./logic/view-model";
export {
	approximateNextRunEpoch,
	badgeForStatus,
	DEFAULT_INTERVAL_MINUTES,
	effectiveSystemPrompt,
	effortOptions,
	emptyForm,
	formatCountdown,
	formatRunTime,
	formDiffers,
	formFromConfig,
	isInheritingSystemPrompt,
	joinInterval,
	nextRunEpoch,
	normalizeHeartbeatConfig,
	normalizeHeartbeatRuns,
	normalizeInterval,
	patchFromForm,
	persistedSystemPrompt,
	relativeLabel,
	splitInterval,
	statusLabelFor,
	viewRun,
	viewRuns,
} from "./logic/view-model";
export { default as HeartbeatView } from "./ui/HeartbeatView.svelte";
export { default as PromptEditor } from "./ui/PromptEditor.svelte";
export { default as RunModal } from "./ui/RunModal.svelte";

/** Public module manifest — aggregated by the shell's "Loaded Modules" view. */
export const manifest = {
	name: "heartbeat",
	description: "Workspace autonomous-agent heartbeat: config, run history, live run chat",
} as const;
