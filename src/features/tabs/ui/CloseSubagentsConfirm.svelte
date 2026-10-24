<script lang="ts">
  import type { Tab } from "../tabs";

  /**
   * The close-subagents confirm dialog: shown when the user closes a tab that
   * still has subagent tabs in its (visible) subagent group. ONE dialog for
   * the whole subtree — "Yes" cascades the close to every transitive
   * descendant (sub-sub-agents included, no further prompts); "No" closes
   * only the tab itself. Escape / backdrop dismisses without closing anything.
   * Native modal dialog with daisyUI chrome: top-layer rendering, focus
   * containment, and inert background even inside the animated sidebar.
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
  function openModal(node: HTMLDialogElement) {
    const opener = document.activeElement;
    node.showModal();
    return {
      destroy() {
        node.close();
        if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
      },
    };
  }
</script>

<dialog
  use:openModal
  class="modal"
  aria-label="Close subagents too?"
  aria-describedby="close-subagents-description"
  oncancel={(event) => {
    event.preventDefault();
    onDismiss();
  }}
>
  <div class="modal-box max-w-md">
    <h3 class="text-lg font-bold">Close subagents too?</h3>
    <div id="close-subagents-description" class="flex flex-col gap-1 py-3">
      <p class="text-sm">
        "{tab.title}" has {subagentCount}
        {subagentCount === 1 ? "subagent tab" : "subagent tabs"} (including nested ones).
      </p>
      <p class="text-sm">
        Close them as well? Their own subagents are closed too, and any in-flight turns are
        stopped.
      </p>
    </div>
    <div class="modal-action flex-wrap">
      <button type="button" class="btn btn-ghost btn-sm" onclick={onDismiss}>Cancel</button>
      <button type="button" class="btn btn-sm" onclick={onKeep}>No, keep them open</button>
      <button type="button" class="btn btn-warning btn-sm" onclick={onCloseAll}>
        Yes, close all {subagentCount + 1}
      </button>
    </div>
  </div>
  <form
    method="dialog"
    class="modal-backdrop"
    onsubmit={(event) => {
      event.preventDefault();
      onDismiss();
    }}
  >
    <button type="submit" aria-label="Dismiss close confirmation">close</button>
  </form>
</dialog>
