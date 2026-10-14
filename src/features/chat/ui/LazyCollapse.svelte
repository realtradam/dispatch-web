<script lang="ts">
  import type { Snippet } from "svelte";

  /**
   * A daisyUI checkbox collapse whose BODY is rendered lazily: nothing inside
   * `.collapse-content` is created until the user first opens it. A long turn
   * has hundreds of collapsed tool/thinking cards, each holding a full JSON
   * input / tool output / thought — building all of that DOM up front (only to
   * be hidden) dominated first paint on slow devices. Once opened the body
   * stays mounted, so the close animation and any inner scroll state work as
   * before. Same markup + classes as the inline collapses it replaces.
   */
  let {
    label,
    titleClass = "",
    title,
    children,
  }: {
    /** aria-label of the toggle checkbox. */
    label: string;
    /** Extra classes on the `.collapse-title` row. */
    titleClass?: string;
    title: Snippet;
    children: Snippet;
  } = $props();

  let open = $state(false);
  let everOpened = $state(false);
  $effect(() => {
    if (open) everOpened = true;
  });
</script>

<div class="collapse w-full rounded-box bg-base-200 text-sm">
  <input type="checkbox" aria-label={label} bind:checked={open} />
  <div class="collapse-title flex min-h-0 min-w-0 items-center gap-2 py-2 whitespace-nowrap font-medium {titleClass}">
    {@render title()}
  </div>
  <div class="collapse-content">
    {#if open || everOpened}
      {@render children()}
    {/if}
  </div>
</div>
