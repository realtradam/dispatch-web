export type {
  CompactionModelOption,
  ImageLimitParse,
  LoadVisionSettings,
  LoadVisionSettingsResult,
  SaveVisionSettings,
  SaveVisionSettingsResult,
  VisionSettings,
  VisionSettingsPatch,
} from "./logic/view-model";
export {
  AUTO_COMPACTION_MODEL,
  compactionModelChanged,
  compactionModelFromValue,
  compactionModelOptions,
  DEFAULT_IMAGE_LIMIT,
  imageLimitChanged,
  imageLimitLabel,
  MAX_IMAGE_LIMIT,
  normalizeVisionSettings,
  parseImageLimit,
  selectedCompactionValue,
} from "./logic/view-model";
export { default as VisionSettingsView } from "./ui/VisionSettingsView.svelte";

/** Public module manifest — aggregated by the shell's "Loaded Modules" view. */
export const manifest = {
  name: "vision",
  description: "Global vision settings (image compaction limit + model)",
} as const;
