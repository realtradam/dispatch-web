import { normalizeChatLimit } from "../../../core/chunks";

/**
 * Pure core for the settings feature — zero DOM, zero effects, zero Svelte.
 *
 * The settings feature exposes FE-local, user-tunable settings. Currently the
 * chat limit (max loaded chunks per conversation; the policy lives in
 * `core/chunks/trim.ts`): this module is the view-model seam that parses +
 * validates a typed value into a normalized limit, so the UI can disable submit
 * and show an error on garbage input. The bound constants + normalization are
 * OWNED by `core/chunks` (the single source of truth); this module never
 * redefines them.
 */

// ── Injected port (consumer-defines-port; the composition root adapts the
//    store's localStorage persistence to this shape). ──────────────────────────

/** Outcome of persisting a chat-limit setting. */
export type ChatLimitSaveResult =
  | { readonly ok: true; readonly chatLimit: number }
  | { readonly ok: false; readonly error: string };

export type SaveChatLimit = (value: number) => Promise<ChatLimitSaveResult>;

// ── chat-limit parse / validate ───────────────────────────────────────────────

/** Result of parsing a typed chat-limit string. */
export type ChatLimitParse =
  | { readonly ok: true; readonly value: number }
  | { readonly ok: false; readonly error: string };

/**
 * Parse a typed chat-limit string into a normalized limit (floored + clamped to
 * [MIN_CHAT_LIMIT, MAX_CHAT_LIMIT] via `normalizeChatLimit`). Empty or
 * non-numeric input is an ERROR (so the UI can disable submit + message), NOT a
 * silent default — the default only applies at boot for an unset key, never
 * from user typing.
 */
export function parseChatLimit(raw: string): ChatLimitParse {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: "Enter a number." };
  }
  const n = Number(trimmed);
  if (!Number.isFinite(n)) {
    return { ok: false, error: "Must be a number." };
  }
  return { ok: true, value: normalizeChatLimit(n) };
}

/**
 * Whether saving `typed` would change the `current` chat limit. A no-op save
 * (empty/invalid, or equal after normalization) should be disabled. This is the
 * dirty-check for the input — it must NOT mutate or clamp, only compare.
 */
export function chatLimitChanged(typed: string, current: number): boolean {
  const parsed = parseChatLimit(typed);
  if (!parsed.ok) return false;
  return parsed.value !== current;
}
