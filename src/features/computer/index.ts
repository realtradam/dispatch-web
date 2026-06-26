export type {
  Badge,
  ComputerListResult,
  ComputerSaveResult,
  ComputerStatusResult,
  ComputerStatusView,
  ComputerView,
  LoadComputerStatus,
  LoadComputers,
  SaveComputer,
  TestComputer,
  TestComputerResult,
  TestResultView,
} from "./logic/view-model";
export {
  formatHost,
  knownHostLabel,
  summarizeComputers,
  viewComputer,
  viewComputerStatus,
  viewComputers,
  viewTestResult,
} from "./logic/view-model";
export { default as ComputerField } from "./ui/ComputerField.svelte";
export { default as ComputerSelect } from "./ui/ComputerSelect.svelte";

/** Public module manifest — aggregated by the shell's "Loaded Modules" view. */
export const manifest = {
  name: "computer",
  description: "Per-conversation / per-workspace SSH computer selection + status",
} as const;
