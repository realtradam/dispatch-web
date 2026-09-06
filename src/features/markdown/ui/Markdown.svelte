<script lang="ts">
  import { renderMarkdown } from "../logic/markdown";
  import { advance, createStreamingMarkdown } from "../logic/streaming-markdown";

  let {
    text,
    streaming = false,
  }: {
    text: string;
    /** Balance dangling delimiters while the message is still generating. */
    streaming?: boolean;
  } = $props();

  // Checkpoint streaming state: one per component instance (per streaming
  // message). It caches the settled blocks' HTML so each delta re-renders only
  // the live tail — never the settled prefix (see logic/streaming-markdown).
  const streamingState = createStreamingMarkdown();

  // While streaming: the checkpoint split (settled prefix + live tail), which
  // equals today's full render at every step modulo inter-block newlines and
  // highlight-on-close. When the message completes (or for every non-streaming
  // chunk): ONE full authoritative render — today's exact behavior, so the
  // final/persisted output is byte-identical by construction.
  const rendered = $derived.by(() => {
    if (!streaming) return { prefixHtml: "", tailHtml: renderMarkdown(text) };
    return advance(streamingState, text);
  });

  let container: HTMLElement;

  // One delegated listener on the stable container handles every code block's
  // copy button — including blocks re-created when the tail html changes
  // (streaming), since the listener lives on the container, not the buttons.
  // Clipboard is the edge effect; absent (insecure context) → no-op.
  $effect(() => {
    const el = container;
    if (el === undefined) return;

    const onClick = (event: Event): void => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest<HTMLButtonElement>("[data-copy]");
      if (button === null) return;

      const code = button.closest(".code-block")?.querySelector("code")?.textContent ?? "";
      const clipboard = navigator.clipboard;
      if (clipboard === undefined) return;

      void clipboard
        .writeText(code)
        .then(() => {
          const prev = button.textContent;
          button.textContent = "Copied";
          setTimeout(() => {
            button.textContent = prev;
          }, 1200);
        })
        .catch(() => {
          // Clipboard denied — leave the button as-is.
        });
    };

    el.addEventListener("click", onClick);
    return () => el.removeEventListener("click", onClick);
  });
</script>

<div class="markdown-body" bind:this={container}>
  {#if streaming}
    <!-- Two sibling wrappers (no padding/border/min-height, so block margins
         collapse across them exactly as if the blocks were direct children).
         Svelte 5 skips the {@html} DOM write when the string is unchanged, so
         the settled prefix's subtree is never re-parsed/re-created/re-laid-out;
         only the tail's subtree is replaced per delta. Both strings are
         DOMPurify-sanitized in the logic modules. -->
    <div class="markdown-stream-prefix">{@html rendered.prefixHtml}</div>
    <div class="markdown-stream-tail">{@html rendered.tailHtml}</div>
  {:else}
    <!-- {@html} is safe here: `html` is DOMPurify-sanitized inside renderMarkdown. -->
    {@html rendered.tailHtml}
  {/if}
</div>
