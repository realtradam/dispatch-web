/**
 * Pure auto-save model for a Named Agent card (plan §5.3/§5.4).
 *
 * A card has NO explicit Save button: provider/model changes save immediately,
 * a name edit saves after a short debounce, and the card shows a status
 * (`Not saved` / `Saving…` / `Saved` / `Save failed` + retry). This module is
 * the PURE model of that: given the card's current DRAFT (the raw input
 * controls), the last PERSISTED state, whether a save is in flight, and an
 * error, it derives the card's display status and what a save would persist.
 *
 * The effectful coordination (debounce timers, dispatching saves, and the
 * monotonic sequence that stops an older response clobbering a newer edit)
 * lives in the component-wired controller (`ui/controller.svelte.ts`), which
 * is itself thin over this purity.
 */

import { isUsableModel, isUsableName, normalizeName } from "./validate";

/**
 * The four auto-save lifecycle states a card reports. `"idle"` = a brand-new
 * unsaved draft (never persisted yet) — shown as "Not saved". `"dirty"` = an
 * existing card whose input differs from what was last saved — also "Not saved"
 * until the (debounced/immediate) save lands. `"saving"` = a save is in flight.
 * `"saved"` = current input matches the last persisted value. `"error"` = the
 * last save failed (a retry is offered). A card that is not yet usable hovers
 * in `"idle"` (never issued a save).
 */
export type SaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";

/** A card's current EDITOR state (the raw form controls). */
export interface AgentDraft {
  /** The persisted id once the card has been created; null for a new draft. */
  readonly id: string | null;
  /** The raw name input (may be unterminated/unedited). */
  readonly name: string;
  /** Selected provider id ("" when none). */
  readonly provider: string;
  /** Selected model suffix under `provider` ("" when none). */
  readonly model: string;
}

/** The card's last PERSISTED definition (the server's canonical record). */
export interface AgentSaved {
  readonly id: string | null;
  readonly name: string;
  readonly model: string;
}

/** The full canonical `<provider>/<model>` name a draft would persist. */
export function draftModel(draft: AgentDraft): string {
  return draft.model === "" ? draft.provider : `${draft.provider}/${draft.model}`;
}

/** The full `<provider>/<model>` name a draft's model suffix maps to. */
export interface DraftValidity {
  readonly nameOk: boolean;
  readonly modelOk: boolean;
  /** True when the card is fully usable (name nonempty+unique, provider+model chosen). */
  readonly usable: boolean;
  /** A message for the first invalid field (for inline hints), or null when usable. */
  readonly message: string | null;
}

/**
 * Validate a draft against its sibling names (the OTHER agents' names, EXCLUDING
 * this card's own id — uniqueness is among distinct agents).
 */
export function draftValidity(draft: AgentDraft, otherNames: readonly string[]): DraftValidity {
  const nameMessage = nameErrorMessage(draft.name, otherNames);
  const nameOk = nameMessage === null;
  const modelOk = draft.provider !== "" && isUsableModel(draftModel(draft));
  const usable = nameOk && modelOk;
  const message = usable ? null : (nameMessage ?? modelMessage(draft));
  return { nameOk, modelOk, usable, message };
}

function nameErrorMessage(name: string, otherNames: readonly string[]): string | null {
  if (normalizeName(name).length === 0) return "Name is required.";
  return isUsableName(name, otherNames) ? null : "A named agent with this name already exists.";
}

function modelMessage(draft: AgentDraft): string | null {
  if (draft.provider === "") return "Select a provider.";
  if (draft.model === "") return "Select a model.";
  return "Select a valid model.";
}

/**
 * Whether the current draft differs from what was last persisted — i.e. a save
 * is owed. Draft is compared by its NAME (normalized) and full MODEL string.
 */
export function isDirty(draft: AgentDraft, saved: AgentSaved): boolean {
  return (
    normalizeName(draft.name) !== normalizeName(saved.name) || draftModel(draft) !== saved.model
  );
}

/**
 * The card's display status, purely from its orchestration inputs:
 *  - No id yet → a never-persisted draft → `"idle"` while unusable or unsaved,
 *    `"error"` if a create attempt failed.
 *  - In-flight save → `"saving"`.
 *  - Last save errored → `"error"`.
 *  - No id and clean (nothing to save) → `"idle"`.
 *  - Dirty (not yet (re)saved) → `"dirty"`.
 *  - Clean + has an id → `"saved"`.
 */
export function saveStatus(
  draft: AgentDraft,
  saved: AgentSaved,
  saving: boolean,
  error: string | null,
): SaveStatus {
  if (saving) return "saving";
  if (error !== null) return "error";
  const hasId = draft.id !== null || saved.id !== null;
  if (!hasId) return "idle";
  return isDirty(draft, saved) ? "dirty" : "saved";
}

/** Short human label for a save status (the card's status line). */
export function saveStatusLabel(status: SaveStatus): string {
  switch (status) {
    case "saving":
      return "Saving…";
    case "saved":
      return "Saved";
    case "error":
      return "Save failed";
    default:
      return "Not saved";
  }
}

/** True iff a status warrants showing the card body as "saved clean" (no warning tint). */
export function isClean(status: SaveStatus): boolean {
  return status === "saved";
}
