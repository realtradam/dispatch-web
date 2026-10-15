<script lang="ts">
  import type { Tab } from "../tabs";

  /**
   * The tab context menu (right-click / touch-and-hold on a tab card): add the
   * tab to a subagent group, remove it from its group, or release its own
   * subagents. Purely presentational grouping. Fixed-positioned at the
   * pointer, clamped into the viewport; closes on Escape / outside press /
   * scroll / resize.
   */
  let {
    tab,
    handle,
    x,
    y,
    groupParent,
    childCount,
    candidates,
    handleFor,
    onAddToGroup,
    onRemoveFromGroup,
    onUngroupChildren,
    onDismiss,
  }: {
    tab: Tab;
    handle: string;
    /** Requested viewport position (pointer). */
    x: number;
    y: number;
    /** The tab's current visible group parent, or null when top-level. */
    groupParent: Tab | null;
    /** Number of tabs directly grouped under this tab. */
    childCount: number;
    /** Tabs this tab may be moved under. */
    candidates: readonly Tab[];
    handleFor: (conversationId: string) => string;
    onAddToGroup: (parentId: string) => void;
    onRemoveFromGroup: () => void;
    onUngroupChildren: () => void;
    onDismiss: () => void;
  } = $props();

  let menuEl = $state<HTMLDivElement>();
  let width = $state(0);
  let height = $state(0);
  const MARGIN = 8;

  const left = $derived(
    Math.max(MARGIN, Math.min(x, (globalThis.innerWidth ?? 0) - width - MARGIN)),
  );
  const top = $derived(
    Math.max(MARGIN, Math.min(y, (globalThis.innerHeight ?? 0) - height - MARGIN)),
  );

  $effect(() => {
    menuEl?.focus();
  });

  function act(fn: () => void): void {
    fn();
    onDismiss();
  }
</script>

<svelte:window
  onkeydown={(e) => {
    if (e.key === "Escape") onDismiss();
  }}
  onpointerdown={(e) => {
    if (menuEl !== undefined && !menuEl.contains(e.target as Node)) onDismiss();
  }}
  onresize={onDismiss}
/>

<div
  bind:this={menuEl}
  bind:clientWidth={width}
  bind:clientHeight={height}
  class="fixed z-50 flex w-64 max-w-[calc(100vw-1rem)] flex-col rounded-lg border border-base-content/15 bg-base-100 p-1 text-sm shadow-xl outline-none"
  style:left="{left}px"
  style:top="{top}px"
  role="menu"
  tabindex="-1"
  aria-label={`Tab menu for ${tab.title}`}
  oncontextmenu={(e) => e.preventDefault()}
>
  <div class="flex min-w-0 items-center gap-1.5 px-2 py-1 text-xs text-base-content/60">
    <span class="shrink-0 rounded bg-base-300 px-1 py-0.5 font-mono text-[10px] leading-none">
      {handle}
    </span>
    <span class="truncate">{tab.title}</span>
  </div>

  {#if groupParent !== null}
    <button
      type="button"
      role="menuitem"
      class="rounded px-2 py-1.5 text-left hover:bg-base-300"
      onclick={() => act(onRemoveFromGroup)}
    >
      Remove from group
      <span class="block truncate text-xs text-base-content/50">
        Currently under {handleFor(groupParent.conversationId)} · {groupParent.title}
      </span>
    </button>
  {/if}

  {#if childCount > 0}
    <button
      type="button"
      role="menuitem"
      class="rounded px-2 py-1.5 text-left hover:bg-base-300"
      onclick={() => act(onUngroupChildren)}
    >
      Ungroup {childCount}
      {childCount === 1 ? "subagent" : "subagents"}
    </button>
  {/if}

  <div class="mt-1 border-t border-base-content/10 px-2 pt-1.5 pb-1 text-xs text-base-content/60">
    Add to group under…
  </div>
  {#if candidates.length === 0}
    <div class="px-2 py-1.5 text-xs text-base-content/40">No other tabs</div>
  {:else}
    <div class="flex max-h-56 flex-col overflow-y-auto">
      {#each candidates as candidate (candidate.conversationId)}
        <button
          type="button"
          role="menuitem"
          class="flex min-w-0 items-center gap-1.5 rounded px-2 py-1.5 text-left hover:bg-base-300"
          data-group-candidate={candidate.conversationId}
          onclick={() => act(() => onAddToGroup(candidate.conversationId))}
        >
          <span
            class="shrink-0 rounded bg-base-300 px-1 py-0.5 font-mono text-[10px] leading-none text-base-content/60"
          >
            {handleFor(candidate.conversationId)}
          </span>
          <span class="truncate">{candidate.title}</span>
        </button>
      {/each}
    </div>
  {/if}
</div>
