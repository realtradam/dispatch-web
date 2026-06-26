<script lang="ts">
  import type { Tab } from "../tabs";
  import { isStuckToEnd, shortHandle } from "../tabs";

  let {
    tabs,
    activeConversationId,
    statusFor,
    onSelect,
    onClose,
    onNewDraft,
    onRename,
  }: {
    tabs: readonly Tab[];
    activeConversationId: string | null;
    /** Returns the conversation's lifecycle status, or undefined when unknown. */
    statusFor?: (conversationId: string) => string | undefined;
    onSelect: (conversationId: string) => void;
    onClose: (conversationId: string) => void;
    onNewDraft: () => void;
    onRename?: (conversationId: string, title: string) => void;
  } = $props();

  // The new-chat button is `position: sticky; right: 0`. It floats over the tabs
  // only while the strip overflows and isn't scrolled fully right; we square its
  // right edge only in that "stuck" state. Pure decision (`isStuckToEnd`) +
  // DOM-measurement at the edge here.
  let scrollEl = $state<HTMLDivElement>();
  let stuck = $state(false);

  // Git-style short handle (shortest unique prefix) per open tab — the visible
  // "tab ID". Derived from the set of open conversation ids; pure helper.
  const handles = $derived.by(() => {
    const ids = tabs.map((t) => t.conversationId);
    const map = new Map<string, string>();
    for (const id of ids) map.set(id, shortHandle(id, ids));
    return map;
  });

  function recompute(): void {
    const el = scrollEl;
    if (el === undefined) {
      stuck = false;
      return;
    }
    stuck = isStuckToEnd({
      scrollLeft: el.scrollLeft,
      clientWidth: el.clientWidth,
      scrollWidth: el.scrollWidth,
    });
  }

  $effect(() => {
    const el = scrollEl;
    if (el === undefined) return;
    // Re-evaluate when the tab set changes (overflow may appear/disappear).
    void tabs;
    recompute();

    el.addEventListener("scroll", recompute, { passive: true });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(recompute) : undefined;
    ro?.observe(el);

    return () => {
      el.removeEventListener("scroll", recompute);
      ro?.disconnect();
    };
  });
  // Inline rename: double-click a tab's title to edit, Enter/blur to save.
  let editingId = $state<string | null>(null);
  let editValue = $state("");
  let editEl = $state<HTMLInputElement>();

  function startRename(tab: Tab): void {
    if (onRename === undefined) return;
    editingId = tab.conversationId;
    editValue = tab.title;
    // Focus the input after it renders.
    queueMicrotask(() => editEl?.focus());
  }

  function commitRename(): void {
    const id = editingId;
    if (id !== null && onRename !== undefined) {
      const trimmed = editValue.trim();
      if (trimmed.length > 0) onRename(id, trimmed);
    }
    editingId = null;
  }

  function cancelRename(): void {
    editingId = null;
  }
</script>

<div bind:this={scrollEl} class="min-w-0 flex-1 overflow-x-auto">
  <div class="tabs tabs-lift min-w-max">
    {#each tabs as tab (tab.conversationId)}
      <div
        class="tab flex w-48 shrink-0 items-center gap-1.5"
        class:tab-active={tab.conversationId === activeConversationId}
        role="tab"
        tabindex="0"
        onclick={() => onSelect(tab.conversationId)}
        onkeydown={(e) => {
          if (e.key === "Enter") onSelect(tab.conversationId);
        }}
      >
        <span
          class="shrink-0 rounded bg-base-300 px-1 py-0.5 font-mono text-[10px] leading-none text-base-content/60"
          title="Tab ID"
        >
          {handles.get(tab.conversationId) ?? tab.conversationId}
        </span>
        {#if editingId === tab.conversationId}
          <input
            bind:this={editEl}
            bind:value={editValue}
            class="min-w-0 flex-1 rounded bg-base-100 px-1 py-0.5 text-left text-sm outline outline-1 outline-primary"
            onclick={(e) => e.stopPropagation()}
            onkeydown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitRename();
              } else if (e.key === "Escape") {
                e.preventDefault();
                cancelRename();
              }
            }}
            onblur={commitRename}
          />
        {:else}
          <span
            class="min-w-0 flex-1 cursor-pointer truncate text-left"
            role="button"
            tabindex="-1"
            title={tab.title}
            ondblclick={(e) => {
              e.stopPropagation();
              startRename(tab);
            }}
          >
            {tab.title}
          </span>
        {/if}
        {#if statusFor?.(tab.conversationId) === "active"}
          <span class="loading loading-spinner loading-xs shrink-0 text-primary"></span>
        {/if}
        <button
          class="btn btn-ghost btn-xs shrink-0"
          aria-label="Close tab"
          onclick={(e) => {
            e.stopPropagation();
            onClose(tab.conversationId);
          }}
        >
          &times;
        </button>
      </div>
    {/each}
    <button
      class="tab sticky right-0 z-10 bg-base-200 shadow-[-2px_0_4px_-1px_rgba(0,0,0,0.2)] {stuck
        ? '!rounded-se-none !rounded-ee-none'
        : ''}"
      class:tab-active={activeConversationId === null}
      aria-label="New chat"
      onclick={() => onNewDraft()}
    >
      {#if activeConversationId === null}
        <span class="max-w-[120px] truncate">New Chat</span>
        <span class="btn btn-ghost btn-xs ml-1" aria-hidden="true">+</span>
      {:else}
        +
      {/if}
    </button>
  </div>
</div>
