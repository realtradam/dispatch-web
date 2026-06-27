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
  const out: string[] = [];
  for (const full of models) {
    const { key } = splitModelName(full);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(key);
    }
  }
  return out;
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
