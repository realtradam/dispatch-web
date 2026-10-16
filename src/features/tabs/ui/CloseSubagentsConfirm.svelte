<script lang="ts">
  import type { Tab } from "../tabs";

  /**
   * The close-subagents confirm dialog: shown when the user closes a tab that
   * still has subagent tabs in its (visible) subagent group. ONE dialog for
   * the whole subtree — "Yes" cascades the close to every transitive
   * descendant (sub-sub-agents included, no further prompts); "No" closes
   * only the tab itself. Escape / backdrop dismisses without closing anything.
   * daisyUI `modal` (controlled: `modal-open`).
   */
  let {
    tab,
    subagentCount,
    onKeep,
    onCloseAll,
    onDismiss,
  }: {
    /** The tab being closed (drives the title shown in the dialog). */
    tab: Tab;
    /** Number of tabs in the tab's subagent group (transitive). */
    subagentCount: number;
    /** "No" — close only this tab, keep the subagents open. */
    onKeep: () => void;
    /** "Yes" — close this tab AND cascade to all its subagents. */
    onCloseAll: () => void;
    /** Escape / backdrop — close nothing. */
    onDismiss: () => void;
  } = $props();
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && onDismiss()} />

<div class="modal modal-open" role="dialog" aria-label="Close subagents too?">
  <div class="modal-box max-w-md">
    <h3 class="text-lg font-bold">Close subagents too?</h3>
    <div class="flex flex-col gap-1 py-3">
      <p class="text-sm">
        "{tab.title}" has {subagentCount}
        {subagentCount === 1 ? "subagent tab" : "subagent tabs"} (including nested ones).
      </p>
      <p class="text-sm">
        Close them as well? Their own subagents are closed too, and any in-flight turns are
        stopped.
      </p>
    </div>
    <div class="modal-action">
      <button type="button" class="btn btn-ghost btn-sm" onclick={onDismiss}>Cancel</button>
      <button type="button" class="btn btn-sm" onclick={onKeep}>No, keep them open</button>
      <button type="button" class="btn btn-warning btn-sm" onclick={onCloseAll}>
        Yes, close all {subagentCount + 1}
      </button>
    </div>
  </div>
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="modal-backdrop" onclick={onDismiss}></div>
</div>
