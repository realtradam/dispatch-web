<script lang="ts">
  import { untrack } from "svelte";
  import { forestFlipIds } from "../tab-flip";
  import {
    buildTabGroups,
    cascadeCloseIds,
    directGroupChildren,
    groupGutterPx,
    groupParentCandidates,
    visibleGroupParents,
  } from "../tab-groups";
  import type { Tab } from "../tabs";
  import { shortHandle } from "../tabs";
  import CloseSubagentsConfirm from "./CloseSubagentsConfirm.svelte";
  import TabCard from "./TabCard.svelte";
  import TabGroupBox from "./TabGroupBox.svelte";
  import TabMenu from "./TabMenu.svelte";
  import { createTabFlip } from "./tab-flip";

  let {
    tabs,
    activeConversationId,
    statusFor,
    onSelect,
    onClose,
    onNewDraft,
    onRename,
    onSetTabGroup,
  }: {
    tabs: readonly Tab[];
    activeConversationId: string | null;
    /** Returns the conversation's lifecycle status, or undefined when unknown. */
    statusFor?: (conversationId: string) => string | undefined;
    onSelect: (conversationId: string) => void;
    onClose: (conversationId: string) => void;
    onNewDraft: () => void;
    onRename?: (conversationId: string, title: string) => void;
    /**
     * Move a tab into a subagent group (parent id) or out of it (null). Purely
     * presentational grouping. When absent, the tab menu is disabled.
     */
    onSetTabGroup?: (conversationId: string, parentId: string | null) => void;
  } = $props();

  // Git-style short handle (shortest unique prefix) per open tab — the visible
  // "tab ID". Derived from the set of open conversation ids; pure helper.
  const handles = $derived.by(() => {
    const ids = tabs.map((t) => t.conversationId);
    const map = new Map<string, string>();
    for (const id of ids) map.set(id, shortHandle(id, ids));
    return map;
  });
  const handleFor = (id: string): string => handles.get(id) ?? id;

  // The subagent-group forest (pure) + the gutter the outermost box bleeds into.
  const forest = $derived(buildTabGroups(tabs));
  const gutter = $derived(groupGutterPx(forest.maxDepth));

  // FLIP: a summoned subagent / closed tab / regroup animates (GSAP Flip).
  // Capture positions (+ ghost leaving elements) BEFORE the DOM updates, play
  // AFTER. Keyed on `forest` only; the DOM work itself is untracked.
  let scrollerEl = $state<HTMLDivElement | undefined>();
  const flip = createTabFlip(() => scrollerEl);
  $effect.pre(() => {
    const next = forestFlipIds(forest);
    untrack(() => flip.capture(next));
  });
  $effect(() => {
    void forest;
    untrack(() => flip.play());
  });

  // Tab menu (right-click / touch-and-hold). Local UI state owned here.
  let menu = $state<{ conversationId: string; x: number; y: number } | null>(null);
  const menuTab = $derived(
    menu === null ? null : (tabs.find((t) => t.conversationId === menu?.conversationId) ?? null),
  );
  const menuGroupParent = $derived.by(() => {
    if (menuTab === null) return null;
    const pid = visibleGroupParents(tabs).get(menuTab.conversationId) ?? null;
    return pid === null ? null : (tabs.find((t) => t.conversationId === pid) ?? null);
  });
  const menuChildren = $derived(
    menuTab === null ? [] : directGroupChildren(tabs, menuTab.conversationId),
  );
  const menuCandidates = $derived(
    menuTab === null ? [] : groupParentCandidates(tabs, menuTab.conversationId),
  );

  function openMenu(conversationId: string, x: number, y: number): void {
    if (onSetTabGroup === undefined) return;
    menu = { conversationId, x, y };
  }

  // Close-with-confirm: a tab whose (visible) subagent group is non-empty
  // gets ONE confirm dialog covering its whole subtree (never one per level).
  // The dialog's ids are snapshotted at open time; a tab the backend closed
  // in the meantime is a no-op for `onClose`. A plain tab closes directly.
  let closeConfirm = $state<{ tab: Tab; cascadeIds: readonly string[] } | null>(null);

  // A remote close or workspace switch must not leave an actionable dialog
  // for a tab that is no longer in this list.
  $effect(() => {
    if (
      closeConfirm !== null &&
      !tabs.some((tab) => tab.conversationId === closeConfirm?.tab.conversationId)
    ) {
      closeConfirm = null;
    }
  });

  function requestClose(conversationId: string): void {
    menu = null;
    const cascadeIds = cascadeCloseIds(tabs, conversationId);
    if (cascadeIds.length <= 1) {
      onClose(conversationId);
      return;
    }
    const tab = tabs.find((t) => t.conversationId === conversationId);
    if (tab === undefined) {
      onClose(conversationId);
      return;
    }
    closeConfirm = { tab, cascadeIds };
  }
</script>

{#snippet card(tab: Tab, wide: boolean, subagentCount: number)}
  <TabCard
    {tab}
    handle={handleFor(tab.conversationId)}
    active={tab.conversationId === activeConversationId}
    status={statusFor?.(tab.conversationId)}
    {wide}
    {subagentCount}
    {onSelect}
    onClose={requestClose}
    {onRename}
    onMenu={openMenu}
  />
{/snippet}

<div class="flex flex-col gap-2">
  <!-- 2-column grid of same-size tab cards, fixed at 70% of the viewport height
       so a long tab set scrolls inside this region instead of growing the
       sidebar. Subagent groups span both columns; `dense` lets a later card
       fill the half-row a group would otherwise leave empty. -->
  <div
    bind:this={scrollerEl}
    class="relative h-[70vh] overflow-y-auto py-0.5"
    style:padding-inline="{gutter}px"
    data-tab-grid
    onscroll={() => (menu = null)}
  >
    <div class="relative grid grid-flow-row-dense grid-cols-2 gap-1.5" role="tablist">
      {#each forest.roots as node (node.tab.conversationId)}
        {#if node.children.length > 0}
          <TabGroupBox {node} level={1} maxDepth={forest.maxDepth} {card} />
        {:else}
          {@render card(node.tab, false, 0)}
        {/if}
      {/each}
    </div>
  </div>

  <button
    type="button"
    class="btn btn-ghost btn-sm w-full border border-base-300"
    class:btn-primary={activeConversationId === null}
    aria-label="New chat"
    onclick={() => onNewDraft()}
  >
    {#if activeConversationId === null}
      New Chat
    {:else}
      + New chat
    {/if}
  </button>
</div>

{#if menu !== null && menuTab !== null && onSetTabGroup !== undefined}
  {@const setGroup = onSetTabGroup}
  {@const target = menuTab.conversationId}
  {@const children = [...menuChildren]}
  <TabMenu
    tab={menuTab}
    handle={handleFor(target)}
    x={menu.x}
    y={menu.y}
    groupParent={menuGroupParent}
    childCount={children.length}
    candidates={menuCandidates}
    {handleFor}
    onAddToGroup={(parentId) => setGroup(target, parentId)}
    onRemoveFromGroup={() => setGroup(target, null)}
    onUngroupChildren={() => {
      for (const id of children) setGroup(id, null);
    }}
    onDismiss={() => (menu = null)}
  />
{/if}

{#if closeConfirm !== null}
  {@const target = closeConfirm.tab}
  {@const cascadeIds = [...closeConfirm.cascadeIds]}
  {@const closeOwner = onClose}
  <CloseSubagentsConfirm
    tab={target}
    subagentCount={cascadeIds.length - 1}
    onKeep={() => {
      closeOwner(target.conversationId);
      closeConfirm = null;
    }}
    onCloseAll={() => {
      for (const id of cascadeIds) closeOwner(id);
      closeConfirm = null;
    }}
    onDismiss={() => (closeConfirm = null)}
  />
{/if}
