<script lang="ts">
  import type { AutoReduceNotice } from "../logic/view-model";
  import type { RestoreOutcome } from "../logic/types";

  let {
    notice,
    onRestore,
    onDismiss,
  }: {
    /** The auto-reduce banner view (providerId + message + from/current limit). */
    notice: AutoReduceNotice;
    /**
     * "Restore to N" — PUT the limit back to `fromLimit`. Returns the outcome so
     * a FAILED restore surfaces an inline error here (the banner owns its error
     * display; the parent only refreshes on success).
     */
    onRestore: (providerId: string, limit: number) => Promise<RestoreOutcome>;
    /** Hide this banner locally (persists hidden while autoReduced stays true). */
    onDismiss: (providerId: string) => void;
  } = $props();

  let restoring = $state(false);
  /** Inline restore error (e.g. "Concurrency service not available"); cleared on retry. */
  let error = $state<string | null>(null);

  async function handleRestore(): Promise<void> {
    restoring = true;
    error = null;
    // The parent PUTs the limit + refreshes status on success; the banner clears
    // once the next poll shows autoReduced===false. On failure the outcome is
    // bubbled back here so the error shows inline next to the button.
    const result = await onRestore(notice.providerId, notice.fromLimit);
    restoring = false;
    if (!result.ok) {
      error = result.error;
    }
  }
</script>

<div
  class="alert alert-warning flex flex-col gap-2 py-2 text-xs"
  role="status"
  data-testid={`auto-reduce-banner-${notice.providerId}`}
>
  <div class="flex items-start gap-2">
    <span class="shrink-0">⚠</span>
    <div class="flex-1">
      <p>{notice.message}</p>
      <p class="opacity-70">
        Was {notice.fromLimit}, now {notice.currentLimit}.
      </p>
    </div>
    <div class="flex shrink-0 items-center gap-1">
      <!-- The "Restore to N" text stays visible while loading (only the spinner is
           prepended) so the button keeps its accessible name during the PUT — a
           spinner-only button loses its name for screen-reader users. -->
      <button
        type="button"
        class="btn btn-warning btn-xs gap-1"
        disabled={restoring}
        onclick={handleRestore}
      >
        {#if restoring}
          <span class="loading loading-spinner loading-xs"></span>
        {/if}
        Restore to {notice.fromLimit}
      </button>
      <button
        type="button"
        class="btn btn-ghost btn-xs"
        aria-label={`Dismiss auto-reduce notice for ${notice.providerId}`}
        onclick={() => onDismiss(notice.providerId)}
      >
        ✕
      </button>
    </div>
  </div>
  {#if error}
    <p class="font-mono text-error" data-testid={`restore-error-${notice.providerId}`}>{error}</p>
  {/if}
</div>
