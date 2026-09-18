/**
 * Pure decision logic for attach-time image compression (the `Compress`
 * toggle on the composer's staged-image thumbnails).
 *
 * The pipeline (re-encode to JPEG + rescale) runs at the browser edge
 * (`../adapter/image-encode`); this module owns every DECISION so it stays
 * pure `input → output` and unit-testable without a DOM:
 *
 * - `shouldConvertImage` — which source formats get converted.
 * - `computeResizedDimensions` — the rescale math (cap the longest edge,
 *   never upscale, preserve aspect).
 * - `useConvertedImage` — the smaller-wins rule.
 */

/** JPEG encode quality for the canvas re-encode. */
export const JPEG_QUALITY = 0.85;

/** Longest-edge cap (px) for the rescale. Never upscale past the source. */
export const MAX_IMAGE_EDGE_PX = 2048;

/**
 * Source formats that get converted. Only LOSSLESS sources are re-encoded:
 * PNG (the screenshot case — multi-MB PNGs are the reason this exists) plus
 * BMP (trivially canvas-decodable in every browser). Already-lossy formats
 * (JPEG/WebP) and animated ones (GIF) are sent verbatim — recompressing them
 * degrades quality and saves nothing, and re-encoding a GIF destroys its
 * animation. TIFF is NOT listed: browsers can't natively decode it, so the
 * canvas path would always fall back to the original anyway. An oversized
 * JPEG stays untouched (the backend's body-budget safety net handles the
 * extreme case).
 */
const CONVERTIBLE_MIME_TYPES = new Set(["image/png", "image/bmp"]);

/**
 * Whether a source MIME type is converted to JPEG at staging time.
 * Unknown/absent MIME types are left alone (conservative — never gamble on
 * bytes we can't classify).
 */
export function shouldConvertImage(mimeType: string | undefined): boolean {
  return mimeType !== undefined && CONVERTIBLE_MIME_TYPES.has(mimeType);
}

/** Pixel dimensions of a raster image. */
export interface Dimensions {
  readonly width: number;
  readonly height: number;
}

/**
 * Target dimensions after the rescale: cap the LONGEST edge at `maxEdge`
 * (default `MAX_IMAGE_EDGE_PX`), never upscale (a smaller source passes
 * through unchanged), and preserve aspect ratio.
 *
 * Pure math — the canvas draw itself lives at the browser edge.
 */
export function computeResizedDimensions(
  width: number,
  height: number,
  maxEdge: number = MAX_IMAGE_EDGE_PX,
): Dimensions {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height };
  const scale = maxEdge / longest;
  // Rounding can never exceed the cap: each scaled edge is ≤ maxEdge before
  // rounding, and the only values that round up land exactly ON the cap.
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/**
 * The smaller-wins rule: the converted JPEG is used only when it is actually
 * FEWER bytes than the original (equal or larger → keep the original).
 * Compared on raw byte counts (File/Blob `size`); base64 inflation affects
 * both sides equally so the ratio is preserved.
 */
export function useConvertedImage(originalBytes: number, convertedBytes: number): boolean {
  return convertedBytes < originalBytes;
}
