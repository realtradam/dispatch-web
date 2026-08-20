/**
 * Pure provider/model dropdown helpers for the Named Agents editor — zero DOM.
 *
 * A Named Agent's persisted `model` is the canonical `<provider>/<model>`
 * identifier, but the edit UI splits it into a provider dropdown + a model
 * dropdown (plan §3/§5.2). These helpers derive those dropdowns from the raw
 * `GET /models` catalog — the SAME key grouping the regular model picker uses.
 * Catalog latency is acceptable here (human configuration), and it must not
 * affect the agent-facing list/summon hot paths (plan §9).
 */

/** The provider id prefix of a `<provider>/<model>` name (the part before the first `/`, or the whole string). */
export function providerFromModel(full: string): string {
  const i = full.indexOf("/");
  return i === -1 ? full : full.slice(0, i);
}

/** The model suffix of a `<provider>/<model>` name (the part after the first `/`; empty when slashless). */
export function modelFromFull(full: string): string {
  const i = full.indexOf("/");
  return i === -1 ? "" : full.slice(i + 1);
}

/** Recombine a provider + model suffix into a canonical `<provider>/<model>` name (provider-only if no model). */
export function joinModel(provider: string, model: string): string {
  return model === "" ? provider : `${provider}/${model}`;
}

/**
 * Distinct provider ids across the catalog, in first-seen order, with numbered
 * OpenCode credentials sorted NUMERICALLY before other providers (the same
 * grouping the regular model picker uses — `opencode-2` before `opencode-10`,
 * then everything else). A friendly display label is produced separately so the
 * RAW id stays what gets persisted.
 */
export function providerOptions(models: readonly string[]): string[] {
  const seen = new Set<string>();
  const openCodeKeys: Array<{ key: string; n: number }> = [];
  const otherKeys: string[] = [];
  for (const full of models) {
    const p = providerFromModel(full);
    if (p === "" || seen.has(p)) continue;
    seen.add(p);
    const n = openCodeNumber(p);
    if (n !== null) openCodeKeys.push({ key: p, n });
    else otherKeys.push(p);
  }
  openCodeKeys.sort((a, b) => a.n - b.n);
  return [...openCodeKeys.map((e) => e.key), ...otherKeys];
}

/** The numeric identity of a numbered OpenCode provider (`opencode-1` → 1), or null. */
export function openCodeNumber(key: string): number | null {
  const m = /^opencode-([1-9][0-9]*)$/.exec(key);
  return m === null ? null : Number(m[1]);
}

/**
 * Friendly display label for a provider id: `opencode-<n>` → "OpenCode #<n>";
 * any other id unchanged. Presentation only — the RAW id is what gets persisted.
 */
export function providerLabel(provider: string): string {
  const n = openCodeNumber(provider);
  return n === null ? provider : `OpenCode #${n}`;
}

/** The model suffixes available under a given provider, in catalog order. */
export function modelsForProvider(models: readonly string[], provider: string): string[] {
  const out: string[] = [];
  for (const full of models) {
    if (providerFromModel(full) === provider) out.push(modelFromFull(full));
  }
  return out;
}

/**
 * The model suffixes in the catalog that a Named Agent's model suffix may match.
 * A saved Named Agent may reference a provider/model pair no longer present in a
 * live catalog (e.g. a credential was removed); the editor then shows the saved
 * RAW full name as an unavailable selection rather than silently rewriting it.
 */
export function fullModelFromSelection(provider: string, model: string): string {
  return joinModel(provider, model);
}
