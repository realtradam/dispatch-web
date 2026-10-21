import type { Tab } from "./tabs";

/**
 * Subagent tab groups — the PURE model behind the tab grid.
 *
 * Each tab may name a tab group parent (`Tab.tabGroupParentId`, the effective
 * value from the backend). The tab grid renders the tabs as a forest: a tab
 * with ≥1 visible child is a GROUP (double-width card + a darker box wrapping
 * it and its children); everything else is a single half-width card. Groups
 * nest (subagents can summon subagents). Purely presentational.
 */

export interface TabGroupNode {
  readonly tab: Tab;
  /** Visible children, in tab order. Non-empty ⇒ this node renders as a group. */
  readonly children: readonly TabGroupNode[];
}

export interface TabGroupForest {
  /** Top-level nodes, in tab order. */
  readonly roots: readonly TabGroupNode[];
  /** Deepest group-box nesting level (0 = no groups, 1 = only top-level groups, …). */
  readonly maxDepth: number;
}

/**
 * The VISIBLE tab group parent of every tab in `tabs`: its `tabGroupParentId`
 * when that names ANOTHER tab in the same set, else null. A tab whose
 * ancestor chain loops back to itself (a cycle — never produced by the
 * backend, but tolerated) is treated as a root, so rendering never loops.
 */
export function visibleGroupParents(tabs: readonly Tab[]): ReadonlyMap<string, string | null> {
  const byId = new Map(tabs.map((t) => [t.conversationId, t]));
  const direct = (id: string): string | null => {
    const p = byId.get(id)?.tabGroupParentId;
    return p !== undefined && p !== id && byId.has(p) ? p : null;
  };
  const out = new Map<string, string | null>();
  for (const tab of tabs) {
    const id = tab.conversationId;
    const parent = direct(id);
    let cyclic = false;
    const seen = new Set<string>([id]);
    let cursor = parent;
    while (cursor !== null) {
      if (cursor === id) {
        cyclic = true;
        break;
      }
      if (seen.has(cursor)) break; // a loop above us that doesn't include us
      seen.add(cursor);
      cursor = direct(cursor);
    }
    out.set(id, cyclic ? null : parent);
  }
  return out;
}

/** Build the group forest for one workspace's tab set (input order preserved). */
export function buildTabGroups(tabs: readonly Tab[]): TabGroupForest {
  const parents = visibleGroupParents(tabs);
  const childIds = new Map<string, string[]>();
  for (const tab of tabs) {
    const p = parents.get(tab.conversationId) ?? null;
    if (p === null) continue;
    const list = childIds.get(p);
    if (list === undefined) childIds.set(p, [tab.conversationId]);
    else list.push(tab.conversationId);
  }
  const byId = new Map(tabs.map((t) => [t.conversationId, t]));
  let maxDepth = 0;
  const build = (tab: Tab, depth: number): TabGroupNode => {
    const ids = childIds.get(tab.conversationId) ?? [];
    if (ids.length > 0) maxDepth = Math.max(maxDepth, depth + 1);
    const children: TabGroupNode[] = [];
    for (const cid of ids) {
      const child = byId.get(cid);
      if (child !== undefined) children.push(build(child, depth + 1));
    }
    return { tab, children };
  };
  const roots = tabs
    .filter((t) => (parents.get(t.conversationId) ?? null) === null)
    .map((t) => build(t, 0));
  return { roots, maxDepth };
}

/** Every (transitive) descendant id of `conversationId` in the VISIBLE grouping. */
export function groupDescendants(tabs: readonly Tab[], conversationId: string): Set<string> {
  const parents = visibleGroupParents(tabs);
  const out = new Set<string>();
  let grew = true;
  while (grew) {
    grew = false;
    for (const [id, p] of parents) {
      if (out.has(id) || id === conversationId || p === null) continue;
      if (p === conversationId || out.has(p)) {
        out.add(id);
        grew = true;
      }
    }
  }
  return out;
}

/**
 * The tabs `conversationId` may be moved under (the "Add to group" menu):
 * every other tab EXCEPT itself, its descendants (that would form a cycle),
 * and its current visible group parent (already there). Tab order preserved.
 */
export function groupParentCandidates(tabs: readonly Tab[], conversationId: string): Tab[] {
  const parents = visibleGroupParents(tabs);
  const current = parents.get(conversationId) ?? null;
  const descendants = groupDescendants(tabs, conversationId);
  return tabs.filter(
    (t) =>
      t.conversationId !== conversationId &&
      t.conversationId !== current &&
      !descendants.has(t.conversationId),
  );
}

/** Ids of the tabs DIRECTLY grouped under `conversationId` (visible grouping). */
export function directGroupChildren(tabs: readonly Tab[], conversationId: string): string[] {
  const parents = visibleGroupParents(tabs);
  return tabs
    .filter((t) => parents.get(t.conversationId) === conversationId)
    .map((t) => t.conversationId);
}

/**
 * Whether a group box's LAST grid row is a nested group box (rather than a
 * card). Mirrors the grid's `row dense` auto-placement: the group parent's
 * double-width card fills row 0; a card takes the first free half-row (or
 * opens a new row); a nested group (spans both columns) always opens a new
 * row. Used to trim the outer box's bottom padding so the gap below a
 * nested box matches the gap at its sides (an even-looking box).
 */
export function lastRowIsGroup(children: readonly TabGroupNode[]): boolean {
  let openHalfRows = 0; // rows with exactly one free cell
  let lastIsGroup = false; // the row-0 parent card is not a group row
  for (const child of children) {
    if (child.children.length > 0) {
      lastIsGroup = true; // opens a new (last) row
    } else if (openHalfRows > 0) {
      openHalfRows -= 1; // back-fills an earlier half row; last row unchanged
    } else {
      openHalfRows += 1; // opens a new (last) row, half-filled
      lastIsGroup = false;
    }
  }
  return lastIsGroup;
}

/**
 * The DaisyUI theme colour a group box at nesting `level` (1 = outermost) is
 * tinted with. Three colours ROTATE by level, so a box always differs from
 * the box around it AND from the one around that (with two colours a box
 * would match its grandparent). `primary` is deliberately excluded — it marks
 * the active tab, which must stay legible inside any box.
 */
export const GROUP_TONES = ["secondary", "success", "accent"] as const;
export type GroupTone = (typeof GROUP_TONES)[number];

export function groupTone(level: number): GroupTone {
  const n = GROUP_TONES.length;
  const i = (((Math.trunc(level) - 1) % n) + n) % n; // non-negative even for level < 1
  return GROUP_TONES[i] ?? GROUP_TONES[0];
}

/**
 * Horizontal bleed (px) of a group box at nesting `level` (1 = outermost)
 * when the deepest box is `maxDepth`. A box bleeds OUTWARD by this much (a
 * negative margin + equal padding), so the cards inside every box sit on
 * exactly the same two grid columns as top-level cards — all cards keep
 * IDENTICAL dimensions at every depth. Outer boxes bleed more than inner
 * ones so nested edges stay visible. The step shrinks for deep nesting so the
 * total gutter (`groupGutterPx`) stays bounded.
 */
export function groupBleedPx(level: number, maxDepth: number): number {
  if (maxDepth <= 0 || level < 1 || level > maxDepth) return 0;
  return (maxDepth - level + 1) * groupStepPx(maxDepth);
}

/** The horizontal gutter the grid must reserve so the outermost box fits. */
export function groupGutterPx(maxDepth: number): number {
  return maxDepth <= 0 ? 0 : maxDepth * groupStepPx(maxDepth);
}

const MAX_STEP_PX = 6;
const MAX_GUTTER_PX = 18;

function groupStepPx(maxDepth: number): number {
  return Math.max(2, Math.min(MAX_STEP_PX, Math.floor(MAX_GUTTER_PX / maxDepth)));
}
