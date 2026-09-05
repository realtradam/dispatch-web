<script lang="ts">
  /**
   * The "Reset layout to default?" confirm (plan 04 §4.4) — the dialog copy
   * names the consequence exactly: this workspace's layout returns to the
   * default; plugin and dropdown customizations are lost (there is NO
   * undo — the no-revert semantics make the reset the recovery path).
   */
  let {
    onConfirm,
    onCancel,
  }: {
    onConfirm: () => void;
    onCancel: () => void;
  } = $props();
</script>

<div class="modal modal-open" role="dialog" aria-label="Reset layout to default?">
  <div class="modal-box max-w-md">
    <h3 class="text-lg font-bold text-warning">Reset layout to default?</h3>
    <p class="py-3 text-sm">
      This workspace's layout returns to the default; plugin and dropdown customizations are lost.
    </p>
    <div class="modal-action">
      <button type="button" class="btn btn-ghost btn-sm" onclick={onCancel}>Cancel</button>
      <button type="button" class="btn btn-warning btn-sm" onclick={onConfirm}>Reset</button>
    </div>
  </div>
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="modal-backdrop" onclick={onCancel}></div>
</div>
