import type { ModelMetadata } from "@dispatch/transport-contract";
import { isVisionModel } from "../../chat";

/**
 * Pure core for the vision settings feature — zero DOM, zero effects, zero Svelte.
 *
 * The global vision configuration (`GET`/`PUT /settings/vision`) controls image
 * compaction: how many native images a vision model keeps per turn before the
 * oldest are transcribed to text (`imageLimit`), and which vision model does the
 * transcribing (`compactionModel`, null = auto). This module is the view-model
 * seam: typed settings, parse/validate, dirty-check, network normalization, and
 * the vision-capable model option list. The composition root adapts the store's
 * HTTP calls to the injected ports.
 */

// ── Types (owned locally — consumer-defines-port; the contract shapes are a
//    plain REST surface not in a shared contract package version bump, mirroring
//    the heartbeat/mcp pattern). If the backend promotes these to a shared
//    package, swap the local types for the imports + re-mirror. ──────────────

/** The global vision settings (mirrors `VisionSettingsResponse`). */
export interface VisionSettings {
  /** Max native images per turn (default 10); 0 disables compaction. */
  readonly imageLimit: number;
  /** Which model transcribes old images (`<key>/<model>`), or null = auto. */
  readonly compactionModel: string | null;
}

/** A partial update (mirrors `SetVisionSettingsRequest`). */
export interface VisionSettingsPatch {
  readonly imageLimit?: number;
  readonly compactionModel?: string | null;
}

// ── Injected ports (consumer-defines-port). ───────────────────────────────────

/** Outcome of loading the vision settings. */
export type LoadVisionSettingsResult =
  | { readonly ok: true; readonly settings: VisionSettings }
  | { readonly ok: false; readonly error: string };

/** Outcome of saving a partial vision-settings update. */
export type SaveVisionSettingsResult =
  | { readonly ok: true; readonly settings: VisionSettings }
  | { readonly ok: false; readonly error: string };

export type LoadVisionSettings = () => Promise<LoadVisionSettingsResult>;
export type SaveVisionSettings = (patch: VisionSettingsPatch) => Promise<SaveVisionSettingsResult>;

// ── Constants ────────────────────────────────────────────────────────────────

/** The backend's default image limit when none is persisted. */
export const DEFAULT_IMAGE_LIMIT = 10;
/** Upper bound for the image limit input (defensive — the backend owns real clamping). */
export const MAX_IMAGE_LIMIT = 1000;

// ── Network normalization (pure; coerces untyped JSON at the seam). ──────────

/**
 * Coerce an untyped JSON body (from `GET /settings/vision`) into a valid
 * `VisionSettings`. A malformed/partial response can never crash the renderer:
 * `imageLimit` falls back to the default; `compactionModel` coerces to null.
 */
export function normalizeVisionSettings(body: unknown): VisionSettings {
  if (body === null || typeof body !== "object") {
    return { imageLimit: DEFAULT_IMAGE_LIMIT, compactionModel: null };
  }
  const raw = body as Record<string, unknown>;
  const limitRaw = raw.imageLimit;
  const imageLimit =
    typeof limitRaw === "number" && Number.isFinite(limitRaw) && limitRaw >= 0
      ? Math.floor(limitRaw)
      : DEFAULT_IMAGE_LIMIT;
  const modelRaw = raw.compactionModel;
  const compactionModel = typeof modelRaw === "string" && modelRaw.length > 0 ? modelRaw : null;
  return { imageLimit, compactionModel };
}

// ── imageLimit parse / validate ───────────────────────────────────────────────

/** Result of parsing a typed image-limit string. */
export type ImageLimitParse =
  | { readonly ok: true; readonly value: number }
  | { readonly ok: false; readonly error: string };

/**
 * Parse a typed image-limit string into a non-negative integer (floored,
 * clamped to [0, MAX_IMAGE_LIMIT]). Empty or non-numeric input is an ERROR
 * (so the UI can disable submit + message), NOT a silent default.
 */
export function parseImageLimit(raw: string): ImageLimitParse {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: "Enter a number." };
  }
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) {
    return { ok: false, error: "Must be 0 or a positive number." };
  }
  const floored = Math.floor(n);
  if (floored > MAX_IMAGE_LIMIT) {
    return { ok: false, error: `Must be at most ${MAX_IMAGE_LIMIT}.` };
  }
  return { ok: true, value: floored };
}

/**
 * Whether saving `typed` would change the `current` image limit. A no-op save
 * (empty/invalid, or equal) should be disabled. This is the dirty-check for the
 * input — it must NOT mutate or clamp, only compare.
 */
export function imageLimitChanged(typed: string, current: number): boolean {
  const parsed = parseImageLimit(typed);
  if (!parsed.ok) return false;
  return parsed.value !== current;
}

// ── compactionModel option list ───────────────────────────────────────────────

/**
 * The sentinel value for the "Auto" option (null compactionModel — the server
 * auto-selects a vision model). Used as the `<option value>` for the auto row.
 */
export const AUTO_COMPACTION_MODEL = "__auto__";

/** A selectable compaction-model option. */
export interface CompactionModelOption {
  /** The value to send (`<key>/<model>`, or `AUTO_COMPACTION_MODEL` for auto). */
  readonly value: string;
  /** The human-readable label. */
  readonly label: string;
  /** Whether this is the "Auto" sentinel. */
  readonly auto: boolean;
}

/**
 * Build the compaction-model dropdown options: the "Auto" entry (null) plus
 * every vision-capable model from the catalog (those with
 * `modelInfo[name].vision === true`), in catalog order. Non-vision models are
 * excluded — they cannot transcribe images.
 */
export function compactionModelOptions(
  models: readonly string[],
  modelInfo: Readonly<Record<string, ModelMetadata>>,
): CompactionModelOption[] {
  const options: CompactionModelOption[] = [
    { value: AUTO_COMPACTION_MODEL, label: "Auto (server-selected)", auto: true },
  ];
  for (const name of models) {
    if (isVisionModel(modelInfo, name)) {
      options.push({ value: name, label: name, auto: false });
    }
  }
  return options;
}

/**
 * The `<option value>` to mark selected for the current `compactionModel`:
 * `AUTO_COMPACTION_MODEL` when null (auto), else the model name itself.
 */
export function selectedCompactionValue(compactionModel: string | null): string {
  return compactionModel ?? AUTO_COMPACTION_MODEL;
}

/**
 * Convert a selected `<option value>` back into a `VisionSettingsPatch`
 * `compactionModel` (the auto sentinel → null). Returns the patch alone so the
 * caller can merge it with other fields.
 */
export function compactionModelFromValue(value: string): string | null {
  return value === AUTO_COMPACTION_MODEL ? null : value;
}

/**
 * Whether choosing `value` would change the current `compactionModel`.
 */
export function compactionModelChanged(value: string, current: string | null): boolean {
  return compactionModelFromValue(value) !== current;
}

// ── Labels ────────────────────────────────────────────────────────────────────

/** A human-readable label for the current image limit (for the status line). */
export function imageLimitLabel(imageLimit: number | null): string {
  if (imageLimit === null) return "Loading…";
  if (imageLimit === 0) return "0 (compaction disabled)";
  if (imageLimit === DEFAULT_IMAGE_LIMIT) return `${imageLimit} (default)`;
  return String(imageLimit);
}
