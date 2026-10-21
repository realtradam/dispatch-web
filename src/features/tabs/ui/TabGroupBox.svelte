<script lang="ts">
  import type { Snippet } from "svelte";
  import type { TabGroupNode } from "../tab-groups";
  import { groupBleedPx, groupTone, lastRowIsGroup } from "../tab-groups";
  import type { Tab } from "../tabs";
  import TabGroupBox from "./TabGroupBox.svelte";

  /**
   * A subagent group: a tinted box spanning both grid columns that wraps the
   * group parent's (double-width) card + its subagents' cards. Recursive —
   * a subagent with its own subagents renders a nested box. The box BLEEDS
   * outward (negative margin + equal padding, `groupBleedPx`) so the cards
   * inside stay on the same two columns as top-level cards: every card keeps
   * identical dimensions at every depth. The padding is EQUAL on all four
   * sides (= the bleed) so the box looks even — except below a nested box on
   * the last row, where it is trimmed to match that box's side gaps. Each
   * box is tinted with one of three theme colours ROTATING by level
   * (`groupTone`), painted OPAQUE (mixed into the sidebar well colour) so a
   * nested box never blends with the box around it, plus a border in the same
   * colour so every box edge reads at a glance.
   */
  let {
    node,
    level,
    maxDepth,
    card,
  }: {
    node: TabGroupNode;
    /** Nesting level of THIS box (1 = outermost). */
    level: number;
    maxDepth: number;
    /** Renders one card: (tab, wide, subagentCount). */
    card: Snippet<[Tab, boolean, number]>;
  } = $props();

  const bleed = $derived(groupBleedPx(level, maxDepth));
  const tone = $derived(groupTone(level));
  // Even spacing: when the last row is a nested box, the gap below it would
  // be this box's full padding while its side gaps are only the DIFFERENCE
  // in bleed (the nested box bleeds outward too) — trim the bottom to match.
  const padBottom = $derived(
    lastRowIsGroup(node.children) ? bleed - groupBleedPx(level + 1, maxDepth) : bleed,
  );
</script>

<div
  class="tab-group-box col-span-2 rounded-lg"
  style:--group-tone="var(--color-{tone})"
  style:margin-inline="-{bleed}px"
  style:padding="{bleed}px {bleed}px {padBottom}px"
  role="group"
  aria-label={`Subagents of ${node.tab.title}`}
  data-tab-group={node.tab.conversationId}
  data-level={level}
  data-tone={tone}
>
  <div class="grid grid-flow-row-dense grid-cols-2 gap-1.5">
    {@render card(node.tab, true, node.children.length)}
    {#each node.children as child (child.tab.conversationId)}
      {#if child.children.length > 0}
        <TabGroupBox node={child} level={level + 1} {maxDepth} {card} />
      {:else}
        {@render card(child.tab, false, 0)}
      {/if}
    {/each}
  </div>
</div>

<style>
  /* Opaque tint: the tone mixed into the sidebar's `.inset-well` colour (the
     surface the tab grid sits on), so nested boxes replace — never compound
     with — the colour around them. */
  .tab-group-box {
    background-color: color-mix(
      in oklab,
      var(--group-tone) 16%,
      var(--inset-well-bg, var(--color-base-200))
    );
    box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--group-tone) 55%, transparent);
  }
</style>
