<script lang="ts">
  let {
    headline,
    lines,
    confirmLabel,
    onCancel,
    onConfirm,
  }: {
    /** The warning headline (e.g. "Unload heartbeat?"). */
    headline: string;
    /** The warning body lines: what else unchecks + the force blast radius. */
    lines: readonly string[];
    confirmLabel: string;
    onCancel: () => void;
    onConfirm: () => void;
  } = $props();
</script>

<div class="modal modal-open" role="dialog" aria-label={headline}>
  <div class="modal-box max-w-md">
    <h3 class="text-lg font-bold text-warning">{headline}</h3>
    <div class="flex flex-col gap-1 py-3">
      {#each lines as line (line)}
        <p class="text-sm">{line}</p>
      {/each}
      <p class="mt-1 text-xs text-error">
        Force stops ALL agents globally — every active turn in every workspace — not just agents
        using this plugin.
      </p>
    </div>
    <div class="modal-action">
      <button type="button" class="btn btn-ghost btn-sm" onclick={onCancel}>Cancel</button>
      <button type="button" class="btn btn-warning btn-sm" onclick={onConfirm}>
        {confirmLabel}
      </button>
    </div>
  </div>
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="modal-backdrop" onclick={onCancel}></div>
</div>
