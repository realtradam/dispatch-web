/**
 * Stable panel keys — the PURE identity scheme behind the panel height
 * animation.
 *
 * Panel leaves carry no required id, so the panels list can't be keyed by the
 * tree. Keying by INDEX is wrong for removal: closing the middle of three
 * panels would re-use the middle DOM node for the third view and animate the
 * LAST panel out. This reconciles a stable numeric key per panel across tree
 * updates, from the view ids alone:
 *
 *  - same length → keys stay positional (a dropdown SWAP keeps its panel —
 *    the panel morphs its height to the new view instead of leaving).
 *  - length changed → the longest common subsequence of view ids keeps its
 *    keys; every unmatched new panel gets a fresh key (an ADD), every
 *    unmatched old key disappears (a REMOVE).
 *
 * Zero Svelte, zero DOM.
 */

export interface PanelKeys {
  /** View id per panel, in order. */
  readonly views: readonly string[];
  /** Stable key per panel, aligned with `views`. */
  readonly keys: readonly number[];
  /** The next fresh key. */
  readonly seed: number;
}

/** Keys for a freshly mounted panels list. */
export function initialPanelKeys(views: readonly string[]): PanelKeys {
  return { views: [...views], keys: views.map((_, i) => i), seed: views.length };
}

/**
 * Reconcile `prev` against the next view list (see the module doc).
 *
 * `removedIndex` is an optional HINT from a local ✕ click: when the next list
 * is exactly `prev` minus that index, that exact panel is the one removed.
 * Without it, closing one of two identical adjacent views is ambiguous to the
 * subsequence match (it would drop the later one).
 */
export function reconcilePanelKeys(
  prev: PanelKeys,
  nextViews: readonly string[],
  removedIndex?: number,
): PanelKeys {
  if (removedIndex !== undefined && isRemovalAt(prev.views, nextViews, removedIndex)) {
    return {
      views: [...nextViews],
      keys: prev.keys.filter((_, i) => i !== removedIndex),
      seed: prev.seed,
    };
  }
  if (nextViews.length === prev.views.length) {
    return { views: [...nextViews], keys: [...prev.keys], seed: prev.seed };
  }
  const matched = lcsMatch(prev.views, nextViews);
  let seed = prev.seed;
  const keys = nextViews.map((_, j) => {
    const i = matched.get(j);
    if (i !== undefined) return prev.keys[i] ?? seed++;
    return seed++;
  });
  return { views: [...nextViews], keys, seed };
}

/**
 * The views whose panel SURVIVED but now mounts a different view (a swap):
 * key → { from, to }. Adds/removes are not swaps.
 */
export function swappedPanels(
  prev: PanelKeys,
  next: PanelKeys,
): Map<number, { from: string; to: string }> {
  const before = new Map(prev.keys.map((k, i) => [k, prev.views[i] ?? ""]));
  const out = new Map<number, { from: string; to: string }>();
  next.keys.forEach((k, i) => {
    const from = before.get(k);
    const to = next.views[i] ?? "";
    if (from !== undefined && from !== to) out.set(k, { from, to });
  });
  return out;
}

function isRemovalAt(prev: readonly string[], next: readonly string[], index: number): boolean {
  if (index < 0 || index >= prev.length || next.length !== prev.length - 1) return false;
  return next.every((v, j) => v === prev[j < index ? j : j + 1]);
}

/** LCS alignment: next index → prev index for every matched element. */
function lcsMatch(a: readonly string[], b: readonly string[]): Map<number, number> {
  const n = a.length;
  const m = b.length;
  // dp[i][j] = LCS length of a[i..] and b[j..]
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const row = dp[i] as number[];
      const below = dp[i + 1] as number[];
      row[j] = a[i] === b[j] ? (below[j + 1] ?? 0) + 1 : Math.max(below[j] ?? 0, row[j + 1] ?? 0);
    }
  }
  const out = new Map<number, number>();
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.set(j, i);
      i++;
      j++;
    } else if ((dp[i + 1]?.[j] ?? 0) >= (dp[i]?.[j + 1] ?? 0)) {
      i++;
    } else {
      j++;
    }
  }
  return out;
}
