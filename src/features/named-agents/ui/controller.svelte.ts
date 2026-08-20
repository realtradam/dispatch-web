// Injected shell for Named Agent auto-save: owns the reactive per-card editing
// + save lifecycle (the thin rune wrapper over `logic/auto-save`), the debounce
// timer for name edits, and the monotonic sequence guard that stops an older
// save response clobbering a newer edit. No ambient state: ONE controller per
// card, created by the view and disposed on unmount. The network calls
// (create/update/delete) are INJECTED ports — this module never touches
// fetch/DOM.
//
// The pure model (`logic/auto-save`) does the status/validity reasoning; this
// controller only owns the effectful plumbing + the sequence guard. A live
// `isNameTaken` callback (supplied by the owning view against the CURRENT
// sibling list) keeps the controller from persisting a duplicate name.

import {
  type AgentDraft,
  type AgentSaved,
  draftModel,
  type SaveStatus,
  saveStatus,
} from "../logic/auto-save";
import type {
  CreateNamedAgent,
  DeleteNamedAgent,
  NamedAgent,
  NamedAgentInput,
  UpdateNamedAgent,
} from "../logic/types";
import { isUsableModel, normalizeName } from "../logic/validate";

/** Named-agent edit port bundle (injected by the composition root). */
export interface NamedAgentPorts {
  create: CreateNamedAgent;
  update: UpdateNamedAgent;
  remove: DeleteNamedAgent;
  /** Debounce delay (ms) for NAME edits only (provider/model saves are immediate). */
  debounceMs?: number;
}

export interface CardSaveState {
  /** The current reactive save status (drives the status line). */
  readonly status: SaveStatus;
  /** A save-failure error message, or null. */
  readonly error: string | null;
}

/** A fully-wired Named Agent card controller (one per card row). */
export interface CardController {
  /** The current reactive status + error. */
  readonly save: CardSaveState;
  /** Read the current draft (const snapshots already applied via the setter methods). */
  readonly draft: AgentDraft;
  /** Whether the card is currently awaiting a save response. */
  readonly saving: boolean;
  /** Bind a provider id into the draft (immediate save once a model is chosen). */
  setProvider(provider: string): void;
  /** Bind a model suffix under the current provider (immediate save). */
  setModel(model: string): void;
  /** Bind a raw name edit (debounced save when it becomes usable). */
  setName(name: string): void;
  /** Remove the Named Agent (for an existing card) — notifies via `onRemoved`. */
  remove(): void;
  /** Dispose timers; call on unmount. */
  dispose(): void;
}

export interface CardControllerOptions {
  /** The existing Named Agent this card edits, or null for a new draft. */
  agent: NamedAgent | null;
  /** The saved full `<provider>/<model>` ('' for a new draft). */
  savedModel: string;
  /**
   * Live uniqueness predicate: true when `name` is already taken by a SIBLING
   * card (the view EXCLUDES this card's own id). Drives the controller's
   * usable-name gate so a duplicate is never persisted.
   */
  isNameTaken: (name: string) => boolean;
  ports: NamedAgentPorts;
  /** Fired with the canonical saved record when a create/update settles. */
  onChanged: (agent: NamedAgent) => void;
  /** Fired when the card should leave the list (after a successful remove, or an unsaved draft). */
  onRemoved: () => void;
}

/**
 * A card controller bound to one Named Agent (existing) or a new draft.
 *
 * The controller owns ONLY this card's draft + save lifecycle; the sibling list
 * (for uniqueness + reconciling the authoritative list after a save) is the
 * parent view's. `onChanged` lets the parent replace the card's canonical record
 * on success; `onRemoved` fires when the card is to be dropped.
 */
export function createCardController(opts: CardControllerOptions): CardController {
  const debounceMs = opts.ports.debounceMs ?? 400;

  // ── The draft: raw form controls (name/provider/model) owned reactively. ──
  const { agent, savedModel } = opts;
  let id = $state<string | null>(agent?.id ?? null);
  let name = $state<string>(agent?.name ?? "");
  let provider = $state<string>(savedModel === "" ? "" : (savedModel.split("/")[0] ?? ""));
  let model = $state<string>(
    savedModel === "" ? "" : savedModel.slice(savedModel.indexOf("/") + 1),
  );

  // ── Saved-state + in-flight/sequence tracking. ──
  // `savedName`/`savedModelValue` = the last PERSISTED definition; `error` =
  // last save failure. `editSeq` increments on every input change; a save
  // captures the seq at dispatch time and applies its result ONLY if it is still
  // the latest — an older response can never overwrite a newer edit (§5.4).
  let savedName = $state<string>(agent?.name ?? "");
  let savedModelValue = $state<string>(savedModel);
  let saving = $state(false);
  let error = $state<string | null>(null);

  let editSeq = 0;
  let nameTimer: ReturnType<typeof setTimeout> | null = null;

  function currentDraft(): AgentDraft {
    return { id, name, provider, model };
  }

  function bump(): number {
    return ++editSeq;
  }

  function nameUsable(): boolean {
    // A usable name is nonempty + not already taken by a sibling card.
    const normalized = normalizeName(name);
    return normalized !== "" && !opts.isNameTaken(normalized);
  }

  function usable(full: string): boolean {
    return nameUsable() && isUsableModel(full);
  }

  // A save is owed + legal to dispatch right now when the card is usable and
  // differs from the persisted definition (or is a fresh, usable draft).
  function shouldSaveNow(): boolean {
    const d = currentDraft();
    const full = draftModel(d);
    if (!usable(full)) return false;
    if (id === null && savedName === "" && savedModelValue === "") return true; // fresh draft
    return normalizeName(d.name) !== savedName || full !== savedModelValue;
  }

  function doSave(seq: number): void {
    const d = currentDraft();
    const full = draftModel(d);
    if (!usable(full)) return;
    saving = true;
    error = null;

    function settle(ok: boolean, saved?: NamedAgent, err?: string): void {
      // Stale-response guard: only apply if this is still the latest edit.
      if (seq !== editSeq) return;
      saving = false;
      if (ok && saved) {
        savedName = saved.name;
        savedModelValue = saved.model;
        id = saved.id;
        opts.onChanged(saved);
      } else {
        error = err ?? "Save failed";
      }
    }

    const input: NamedAgentInput = { name: normalizeName(d.name), model: full };
    if (id === null) {
      void opts.ports.create(input).then(
        (r) => (r.ok ? settle(true, r.agent) : settle(false, undefined, r.error)),
        (e) => settle(false, undefined, String(e)),
      );
    } else {
      void opts.ports.update(id, input).then(
        (r) => (r.ok ? settle(true, r.agent) : settle(false, undefined, r.error)),
        (e) => settle(false, undefined, String(e)),
      );
    }
  }

  function scheduleNameSave(): void {
    if (nameTimer !== null) clearTimeout(nameTimer);
    const seq = editSeq;
    nameTimer = setTimeout(() => {
      nameTimer = null;
      if (shouldSaveNow()) doSave(seq);
    }, debounceMs);
  }

  function saveImmediately(): void {
    if (nameTimer !== null) {
      clearTimeout(nameTimer);
      nameTimer = null;
    }
    const seq = editSeq;
    if (shouldSaveNow()) doSave(seq);
  }

  // Reactive derived status: from the current draft + saved + in-flight + error,
  // via the PURE `saveStatus` (this shell supplies only the orchestration inputs).
  const save = $derived.by<CardSaveState>(() => {
    const d = currentDraft();
    const saved: AgentSaved = { id, name: savedName, model: savedModelValue };
    return { status: saveStatus(d, saved, saving, error), error };
  });

  return {
    get save(): CardSaveState {
      return save;
    },
    get draft(): AgentDraft {
      return currentDraft();
    },
    get saving(): boolean {
      return saving;
    },
    setProvider(next: string): void {
      bump();
      provider = next;
      // Changing provider clears the prior model if it may not belong to the new
      // one; the model dropdown re-populates from the new provider. Persist only
      // once a valid model is selected (§5.5) → the model change saves immediately.
      model = "";
    },
    setModel(next: string): void {
      bump();
      model = next;
      saveImmediately();
    },
    setName(next: string): void {
      bump();
      name = next;
      scheduleNameSave();
    },
    remove(): void {
      if (id === null) {
        // An unsaved draft — nothing server-side to delete.
        opts.onRemoved();
        return;
      }
      saving = true;
      void opts.ports.remove(id).then(
        () => {
          saving = false;
          opts.onRemoved();
        },
        (e) => {
          saving = false;
          error = String(e);
        },
      );
    },
    dispose(): void {
      if (nameTimer !== null) clearTimeout(nameTimer);
      nameTimer = null;
    },
  };
}
