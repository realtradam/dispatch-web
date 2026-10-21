import type { TabGroupForest, TabGroupNode } from "./tab-groups";

/**
 * Flip ids — the PURE identity scheme behind the tab grid's FLIP animation.
 *
 * Every animated element carries a `data-flip-id`: a tab card uses its
 * conversation id, a group box uses `group:<parent conversation id>`. The ids
 * are stable across re-renders even when the DOM node is replaced (a card
 * becoming a double-width group parent is a NEW node), which is what lets
 * GSAP Flip morph the old element into the new one.
 */

const GROUP_PREFIX = "group:";

/** Flip id of a tab card. */
export function cardFlipId(conversationId: string): string {
  return conversationId;
}

/** Flip id of the group box wrapping `parentConversationId` + its subagents. */
export function groupFlipId(parentConversationId: string): string {
  return `${GROUP_PREFIX}${parentConversationId}`;
}

/** Whether a flip id names a group box (vs a tab card). */
export function isGroupFlipId(flipId: string): boolean {
  return flipId.startsWith(GROUP_PREFIX);
}

/** Every flip id the grid renders for `forest` (cards + group boxes). */
export function forestFlipIds(forest: TabGroupForest): Set<string> {
  const out = new Set<string>();
  const walk = (node: TabGroupNode): void => {
    out.add(cardFlipId(node.tab.conversationId));
    if (node.children.length > 0) out.add(groupFlipId(node.tab.conversationId));
    for (const child of node.children) walk(child);
  };
  for (const root of forest.roots) walk(root);
  return out;
}

/** The currently-rendered flip ids that the NEXT render drops (order kept). */
export function leavingFlipIds(current: readonly string[], next: ReadonlySet<string>): string[] {
  return current.filter((id) => !next.has(id));
}
