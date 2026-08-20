import type { ModelMetadata } from "@dispatch/transport-contract";

/**
 * Pure helpers for the two-step model picker.
 *
 * Models arrive from `GET /models` as `<key>/<model>` strings, where `key` is
 * the credential name (the part before the FIRST slash) and `model` is the rest.
 * These pure functions split that into a key selector + a model selector and
 * recombine the choice — zero DOM, zero Svelte.
 */

export interface SplitModel {
  readonly key: string;
  readonly model: string;
}

/** Split `<key>/<model>` on the first slash. A slashless name is all-key. */
export function splitModelName(full: string): SplitModel {
  const i = full.indexOf("/");
  if (i === -1) return { key: full, model: "" };
  return { key: full.slice(0, i), model: full.slice(i + 1) };
}

/** Recombine a key + model into a `<key>/<model>` name (key-only if no model). */
export function joinModelName(key: string, model: string): string {
  return model === "" ? key : `${key}/${model}`;
}

/** Distinct keys across all models, in first-seen order. */
export function modelKeys(models: readonly string[]): string[] {
  const seen = new Set<string>();
  const openCodeKeys: Array<{ key: string; n: number }> = [];
  const otherKeys: string[] = [];
  for (const full of models) {
    const { key } = splitModelName(full);
    if (seen.has(key)) continue;
    seen.add(key);
    const n = openCodeNumber(key);
    if (n !== null) openCodeKeys.push({ key, n });
    else otherKeys.push(key);
  }
  // Numbered OpenCode credentials sort NUMERICALLY (#2 before #10), placed
  // before other providers (the primary credential in this app). Others keep
  // first-seen order.
  openCodeKeys.sort((a, b) => a.n - b.n);
  return [...openCodeKeys.map((e) => e.key), ...otherKeys];
}

/**
 * The stable numeric identity of a numbered OpenCode provider id/key
 * (`opencode-1` → 1, `opencode-10` → 10), or `null` when the id is not a
 * numbered OpenCode key. Numbers are canonical positive integers with no
 * leading zeros.
 */
export function openCodeNumber(key: string): number | null {
  const m = /^opencode-([1-9][0-9]*)$/.exec(key);
  return m === null ? null : Number(m[1]);
}

/** True iff `id` is a numbered OpenCode provider/key (`opencode-<n>`). */
export function isNumberedOpenCode(id: string): boolean {
  return openCodeNumber(id) !== null;
}

/**
 * A friendly human label for a model key/provider id: `opencode-<n>` →
 * "OpenCode #<n>"; any other id is returned unchanged. The RAW id is still what
 * gets selected/persisted — this only affects display.
 */
export function modelKeyLabel(key: string): string {
  const n = openCodeNumber(key);
  return n === null ? key : `OpenCode #${n}`;
}

/**
 * Migration helper: rewrite a legacy `opencode/<model>` full model name to the
 * numbered `opencode-1/<model>` namespace. Returns the input unchanged for
 * anything that is not `opencode/`-prefixed (already-numbered names, other
 * providers). Idempotent. This is the FE-side persisted-state migration; the
 * backend performs its own equivalent on its own store.
 */
export function migrateLegacyModelName(full: string): string {
  const legacyPrefix = "opencode/";
  if (!full.startsWith(legacyPrefix)) return full;
  const model = full.slice(legacyPrefix.length);
  return model.length === 0 ? full : `opencode-1/${model}`;
}

/** The model suffixes available under a given key, in order. */
export function modelsForKey(models: readonly string[], key: string): string[] {
  const out: string[] = [];
  for (const full of models) {
    const split = splitModelName(full);
    if (split.key === key) out.push(split.model);
  }
  return out;
}

/**
 * Whether a given full model name (`<key>/<model>`) is vision-capable — i.e.
 * `GET /models` `modelInfo[name].vision === true`. Absent/`false`/unknown →
 * `false` (the server's vision handoff transcribes images to text for it).
 * Pure lookup against the catalog metadata; zero DOM.
 */
export function isVisionModel(
  modelInfo: Readonly<Record<string, ModelMetadata>>,
  fullName: string,
): boolean {
  return modelInfo[fullName]?.vision === true;
}

// ── Named Agents synthetic provider (plan §6) ────────────────────────────────
//
// The regular model picker gains a "Named Agents" provider at the TOP of the
// provider list. Selecting it + a Named Agent name resolves to that agent's raw
// model for the conversation AND records a snapshot so the selection survives
// later edits to the shared preset. These helpers are structural (they take a
// minimal NamedAgent-ish shape) so `model-select` stays decoupled from the
// named-agents feature up the chain; the picker binds the real types.

/** A minimal Named Agent shape the synthetic provider needs (structural). */
export interface NamedAgentLike {
  readonly id: string;
  readonly name: string;
  readonly model: string;
}

/** A minimal per-conversation Named Agent selection snapshot (structural). */
export interface NamedAgentSnapshotLike {
  readonly namedAgentId: string;
  readonly namedAgentName: string;
  readonly model: string;
}

/**
 * The synthetic "Named Agents" provider id used by the regular model picker
 * (plan §6). Deliberately a value that can never collide with a real provider
 * (`<credentialName>`), so the provider dropdown treats it as the first option.
 */
export const NAMED_AGENTS_PROVIDER = "__named_agents__";

/** The friendly label of the synthetic Named Agents provider. */
export function namedAgentsProviderLabel(): string {
  return "Named Agents";
}

/**
 * The provider dropdown options for the picker: the synthetic "Named Agents"
 * provider ALWAYS first, then the raw providers (via `modelKeys`). The synthetic
 * entry stays present even with zero Named Agents (plan §6 shows a disabled
 * "No named agents configured" model option).
 */
export function providerKeysWithNamedAgents(models: readonly string[]): string[] {
  return [NAMED_AGENTS_PROVIDER, ...modelKeys(models)];
}

/** The Named Agent names offered in the model dropdown when the synthetic provider is selected. */
export function namedAgentNames(agents: readonly NamedAgentLike[]): string[] {
  return agents.map((a) => a.name);
}

/**
 * Whether a full raw model string corresponds to a Named Agent snapshot —
 * i.e. the conversation was selected via a Named Agent whose captured raw model
 * equals `selected`. When true, the picker displays `Named Agents -> <name>`.
 */
export function isNamedAgentSelection(
  selected: string,
  snapshot: NamedAgentSnapshotLike | null,
): boolean {
  return snapshot !== null && snapshot.model === selected;
}

/**
 * The snapshot label shown in the model dropdown for a Named Agent selection:
 * "Named Agents -> <name>". Pure display.
 */
export function namedAgentSelectionLabel(name: string): string {
  return `${namedAgentsProviderLabel()} -> ${name}`;
}
