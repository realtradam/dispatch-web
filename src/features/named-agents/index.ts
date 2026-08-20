export {
  type AgentDraft,
  type AgentSaved,
  type DraftValidity,
  draftModel,
  draftValidity,
  isClean,
  isDirty,
  type SaveStatus,
  saveStatus,
  saveStatusLabel,
} from "./logic/auto-save";
export {
  normalizeNamedAgent,
  normalizeNamedAgentRecord,
  normalizeNamedAgents,
  toNamedAgentInput,
} from "./logic/normalize";
export {
  fullModelFromSelection,
  joinModel,
  modelFromFull,
  modelsForProvider,
  openCodeNumber,
  providerFromModel,
  providerLabel,
  providerOptions,
} from "./logic/options";
export { findNamedAgent, snapshotFor } from "./logic/snapshot";
export type {
  CreateNamedAgent,
  DeleteNamedAgent,
  LoadNamedAgents,
  NamedAgent,
  NamedAgentDeleteResult,
  NamedAgentInput,
  NamedAgentResponse,
  NamedAgentSaveResult,
  NamedAgentSelectionSnapshot,
  NamedAgentsResponse,
  NamedAgentsResult,
  UpdateNamedAgent,
} from "./logic/types";
export {
  isUsableModel,
  isUsableName,
  nameError,
  normalizeName,
} from "./logic/validate";
export {
  type CardController,
  type CardControllerOptions,
  type CardSaveState,
  createCardController,
  type NamedAgentPorts,
} from "./ui/controller.svelte";
export { default as NamedAgentCard } from "./ui/NamedAgentCard.svelte";
export { default as NamedAgentsView } from "./ui/NamedAgentsView.svelte";

/** Public module manifest — aggregated by the shell's "Loaded Modules" view. */
export const manifest = {
  name: "named-agents",
  description: "Curated Named Agent presets (name + model) in the sidebar",
} as const;
