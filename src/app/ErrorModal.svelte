<script lang="ts">
  /**
   * Full-screen error modal — surfaces critical errors that would otherwise be
   * silently swallowed (e.g. the cross-device tab-restore fetch failing). Shows
   * the full error text + stack trace in a scrollable `<pre>`, a Copy button
   * (clipboard), and an X to dismiss. Pure presentation: the error string and
   * dismiss callback are injected as props.
   */
  let {
    error,
    onDismiss,
  }: {
    error: string;
    onDismiss: () => void;
  } = $props();

  let copied = $state(false);
  let copyTimer: ReturnType<typeof setTimeout> | undefined;

  async function handleCopy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(error);
      copied = true;
      clearTimeout(copyTimer);
      copyTimer = setTimeout(() => {
        copied = false;
      }, 2000);
    } catch {
      // Clipboard API may be unavailable (non-secure context). Fallback:
      // select the text so the user can Ctrl+C manually.
      const pre = document.getElementById("error-modal-text");
      if (pre !== null) {
        const range = document.createRange();
        range.selectNodeContents(pre);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
    }
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      onDismiss();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- Full-screen overlay: fixed, high z-index, semi-transparent backdrop. -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
  role="dialog"
  aria-modal="true"
  aria-label="Error"
>
  <div class="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-lg bg-base-100 shadow-xl">
    <!-- Header -->
    <div class="flex items-center justify-between border-b border-base-300 px-4 py-3">
      <div class="flex items-center gap-2">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          stroke-width="2"
          stroke="currentColor"
          class="size-5 text-error"
          aria-hidden="true"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
          />
        </svg>
        <h2 class="text-lg font-semibold text-error">Something went wrong</h2>
      </div>
      <button
        type="button"
        class="btn btn-ghost btn-sm btn-square"
        aria-label="Dismiss error"
        onclick={onDismiss}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          stroke-width="2"
          stroke="currentColor"
          class="size-5"
          aria-hidden="true"
        >
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
        </svg>
      </button>
    </div>

    <!-- Body: scrollable error text -->
    <div class="overflow-auto p-4">
      <pre
        id="error-modal-text"
        class="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed opacity-80">{error}</pre>
    </div>

    <!-- Footer: copy button -->
    <div class="flex items-center justify-between gap-2 border-t border-base-300 px-4 py-3">
      <span class="text-xs opacity-50">Press Esc to dismiss</span>
      <button
        type="button"
        class="btn btn-sm {copied ? 'btn-success' : 'btn-outline'}"
        onclick={handleCopy}
      >
        {#if copied}
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            stroke-width="2"
            stroke="currentColor"
            class="size-4"
            aria-hidden="true"
          >
            <path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5" />
          </svg>
          Copied
        {:else}
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            stroke-width="2"
            stroke="currentColor"
            class="size-4"
            aria-hidden="true"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 0 1-1.125-1.125v-9.25m18 3.75h-3.75m3.75 0-2.25 2.25m2.25-2.25 2.25 2.25M4.5 6.75 6.75 4.5"
            />
          </svg>
          Copy
        {/if}
      </button>
    </div>
  </div>
</div>
