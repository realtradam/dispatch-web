<script lang="ts">
  import { cardFlipId } from "../tab-flip";
  import type { Tab } from "../tabs";

  /**
   * One tab in the tab grid — a fixed-height card. Every card has IDENTICAL
   * dimensions; a group parent (`wide`) simply spans both grid columns.
   * Right-click (or touch-and-hold) asks the owner to open the tab menu.
   */
  let {
    tab,
    handle,
    active,
    status,
    wide = false,
    subagentCount = 0,
    onSelect,
    onClose,
    onRename,
    onMenu,
  }: {
    tab: Tab;
    /** Short-handle (git-style unique prefix) shown in the id badge. */
    handle: string;
    active: boolean;
    /** Lifecycle status (drives the spinner), when known. */
    status: string | undefined;
    /** Group parent: spans both grid columns. */
    wide?: boolean;
    /** Number of direct subagents (shown on a group parent). */
    subagentCount?: number;
    onSelect: (conversationId: string) => void;
    onClose: (conversationId: string) => void;
    onRename?: ((conversationId: string, title: string) => void) | undefined;
    /** Open the tab menu at viewport coordinates. */
    onMenu: (conversationId: string, x: number, y: number) => void;
  } = $props();

  // Inline rename: double-click the title to edit, Enter/blur to save.
  let editing = $state(false);
  let editValue = $state("");
  let editEl = $state<HTMLInputElement>();

  function startRename(): void {
    if (onRename === undefined) return;
    editing = true;
    editValue = tab.title;
    queueMicrotask(() => editEl?.focus());
  }

  function commitRename(): void {
    if (!editing) return;
    const trimmed = editValue.trim();
    if (trimmed.length > 0 && onRename !== undefined) onRename(tab.conversationId, trimmed);
    editing = false;
  }

  // Click-to-copy the FULL conversation id; the badge text is selected as the
  // feedback (and as a manual-copy fallback when the clipboard is unavailable).
  async function copyId(el: HTMLElement): Promise<void> {
    const range = document.createRange();
    range.selectNodeContents(el);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    const clipboard = navigator.clipboard;
    if (clipboard === undefined) return;
    try {
      await clipboard.writeText(tab.conversationId);
    } catch {
      // Selection already lets the user copy manually.
    }
  }

  // Touch-and-hold → menu (iOS Safari never fires `contextmenu`; Android does,
  // and opening twice at the same spot is idempotent).
  const LONG_PRESS_MS = 500;
  const MOVE_TOLERANCE_PX = 10;
  let pressTimer: ReturnType<typeof setTimeout> | null = null;
  let pressX = 0;
  let pressY = 0;
  let suppressClick = false;

  function cancelPress(): void {
    if (pressTimer !== null) clearTimeout(pressTimer);
    pressTimer = null;
  }

  function onPointerDown(e: PointerEvent): void {
    if (e.pointerType !== "touch") return;
    cancelPress();
    pressX = e.clientX;
    pressY = e.clientY;
    pressTimer = setTimeout(() => {
      pressTimer = null;
      suppressClick = true;
      onMenu(tab.conversationId, pressX, pressY);
    }, LONG_PRESS_MS);
  }

  function onPointerMove(e: PointerEvent): void {
    if (pressTimer === null) return;
    if (Math.hypot(e.clientX - pressX, e.clientY - pressY) > MOVE_TOLERANCE_PX) cancelPress();
  }

  $effect(() => cancelPress);
</script>

<div
  class="tab-card group/card relative flex h-[4.5rem] min-w-0 cursor-pointer flex-col justify-between rounded-md border px-2 py-1.5 text-sm transition-colors {active
    ? 'border-primary bg-primary/15'
    : 'border-base-content/10 bg-base-300 hover:border-base-content/25'}"
  class:col-span-2={wide}
  role="tab"
  tabindex="0"
  aria-selected={active}
  title={tab.title}
  data-conversation-id={tab.conversationId}
  data-flip-id={cardFlipId(tab.conversationId)}
  data-wide={wide ? "true" : undefined}
  onclick={() => {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    onSelect(tab.conversationId);
  }}
  onkeydown={(e) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter") onSelect(tab.conversationId);
    else if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
      e.preventDefault();
      const r = e.currentTarget.getBoundingClientRect();
      onMenu(tab.conversationId, r.left + 8, r.bottom);
    }
  }}
  oncontextmenu={(e) => {
    e.preventDefault();
    cancelPress();
    onMenu(tab.conversationId, e.clientX, e.clientY);
  }}
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={cancelPress}
  onpointercancel={cancelPress}
  onpointerleave={cancelPress}
>
  <div class="flex min-w-0 items-center gap-1">
    <button
      type="button"
      class="shrink-0 select-text rounded bg-base-100 px-1 py-0.5 font-mono text-[10px] leading-none text-base-content/60 transition-colors hover:bg-primary hover:text-primary-content"
      data-copy-id={tab.conversationId}
      title="Click to copy conversation id"
      aria-label={`Copy conversation id ${tab.conversationId}`}
      onclick={(e) => {
        e.stopPropagation();
        void copyId(e.currentTarget);
      }}
    >
      {handle}
    </button>
    {#if wide && subagentCount > 0}
      <span
        class="shrink-0 truncate rounded bg-base-100 px-1 py-0.5 text-[10px] leading-none text-base-content/60"
        data-subagent-count={subagentCount}
      >
        {subagentCount}
        {subagentCount === 1 ? "subagent" : "subagents"}
      </span>
    {/if}
    <span class="flex-1"></span>
    {#if status === "queued"}
      <!-- Waiting for a concurrency slot — a ring (vs the dots of `active`). -->
      <span
        class="loading loading-ring loading-xs shrink-0 text-primary"
        aria-label="Queued"
        title="Waiting for a concurrency slot"
      ></span>
    {:else if status === "active"}
      <span class="loading loading-dots loading-xs shrink-0 text-primary"></span>
    {/if}
    <button
      type="button"
      class="btn btn-ghost btn-xs -mr-1 h-5 min-h-5 w-5 shrink-0 p-0 text-base-content/60"
      aria-label="Close tab"
      onclick={(e) => {
        e.stopPropagation();
        onClose(tab.conversationId);
      }}
    >
      &times;
    </button>
  </div>
  {#if editing}
    <input
      bind:this={editEl}
      bind:value={editValue}
      class="w-full min-w-0 rounded bg-base-100 px-1 py-0.5 text-left text-xs outline outline-1 outline-primary"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commitRename();
        } else if (e.key === "Escape") {
          e.preventDefault();
          editing = false;
        }
      }}
      onblur={commitRename}
    />
  {:else}
    <span
      class="line-clamp-2 min-w-0 break-words text-left text-xs leading-tight"
      role="button"
      tabindex="-1"
      title={tab.title}
      ondblclick={(e) => {
        e.stopPropagation();
        startRename();
      }}
    >
      {tab.title}
    </span>
  {/if}
</div>

<style>
  /* Touch-and-hold opens the tab menu — suppress the native callout/selection. */
  .tab-card {
    -webkit-touch-callout: none;
    -webkit-user-select: none;
    user-select: none;
  }
</style>
