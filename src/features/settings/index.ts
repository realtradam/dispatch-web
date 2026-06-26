export type { ChatLimitParse, ChatLimitSaveResult, SaveChatLimit } from "./logic/view-model";
export { chatLimitChanged, parseChatLimit } from "./logic/view-model";
export { default as ChatLimitField } from "./ui/ChatLimitField.svelte";

/** Public module manifest — aggregated by the shell's "Loaded Modules" view. */
export const manifest = {
  name: "settings",
  description: "FE-local settings (chat limit)",
} as const;
