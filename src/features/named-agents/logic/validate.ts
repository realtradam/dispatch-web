/**
 * Pure validation for Named Agent form fields — zero DOM, zero effects.
 *
 * A Named Agent is usable only when (plan §5.4): the name is nonempty + unique
 * case-insensitively, and a provider + model are selected. These pure helpers
 * drive the card UI's validity gating + inline messages; the backend remains
 * the authority (it 400s/conflicts on a duplicate or empty name / malformed
 * model identifier).
 */

/** Trim + collapse runs of whitespace inside a name (survey-style display). */
export function normalizeName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

/**
 * A name-validation error message, or `null` when the name is valid. `otherNames`
 * are the OTHER agents' names for the case-insensitive uniqueness check (the
 * caller EXCLUDES the card's own last-persisted name / the card being edited).
 */
export function nameError(name: string, otherNames: readonly string[]): string | null {
  const normalized = normalizeName(name);
  if (normalized.length === 0) return "Name is required.";
  const lower = normalized.toLowerCase();
  for (const other of otherNames) {
    if (other.trim().toLowerCase() === lower) return "A named agent with this name already exists.";
  }
  return null;
}

/** True iff `name` is a unique, nonempty agent name among `otherNames`. */
export function isUsableName(name: string, otherNames: readonly string[]): boolean {
  return nameError(name, otherNames) === null;
}

/**
 * Whether a full model identifier is syntactically valid — a canonical
 * `<provider>/<model>` with a nonempty provider (the part before the first "/")
 * AND a nonempty model (the part after). A slashless or provider-only value is
 * invalid for a Named Agent (it must resolve to a concrete model).
 */
export function isUsableModel(full: string): boolean {
  const i = full.indexOf("/");
  if (i <= 0) return false; // no slash, or empty provider
  const model = full.slice(i + 1);
  return model.length > 0;
}
