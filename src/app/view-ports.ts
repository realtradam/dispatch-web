/**
 * The port bag the composition root hands to every registered view wrapper.
 *
 * This is the ONLY shape of app state the wrappers may touch: the app store
 * plus the two chrome ports that live outside the tree (the system-prompt
 * builder modal and the heartbeat run modal). Keeping it here is what makes
 * `register-views.ts` possible — the wrappers take `{ ports }` and close over
 * exactly what `viewContent` used to pass in App.svelte.
 */

import { tick } from "svelte";
import type { HeartbeatRunView } from "../features/heartbeat";
import type { AppStore } from "./store.svelte";

/**
 * The chat transcript's live scroll element, shared with views that must
 * preserve the reader's viewport across a prepend (today: the settings view's
 * chat-limit save — the same mechanism as "show earlier"). The chat pane writes
 * it on mount via an effect; nothing else may.
 */
export interface ChatViewportBridge {
  el: HTMLElement | null;
}

export interface AppViewPorts {
  readonly store: AppStore;
  readonly chatViewport: ChatViewportBridge;
  /** Chrome: open the system-prompt builder modal (app shell state, not a view). */
  readonly openSystemPromptBuilder: () => void;
  /** Chrome: open the heartbeat run modal for a run (app shell state, not a view). */
  readonly openHeartbeatRun: (run: HeartbeatRunView) => void;
}

/**
 * Run an async action that PREPENDS transcript content while preserving the
 * reader's viewport position: prepended content grows scrollHeight, so shift
 * scrollTop by the growth (the manual analogue of CSS scroll anchoring, which
 * not every engine applies here). Used by "show earlier" AND the chat-limit
 * save (which refills older history on a raise).
 */
export async function preserveViewportAcross<T>(
  el: HTMLElement | null | undefined,
  run: () => Promise<T>,
): Promise<T> {
  const prevHeight = el?.scrollHeight ?? 0;
  const prevTop = el?.scrollTop ?? 0;
  const result = await run();
  await tick();
  if (el) {
    const delta = el.scrollHeight - prevHeight;
    if (delta > 0) el.scrollTop = prevTop + delta;
  }
  return result;
}
