import {
  computeResizedDimensions,
  JPEG_QUALITY,
  shouldConvertImage,
  useConvertedImage,
} from "../logic/image-compress";

/** A successfully converted image: a JPEG blob at `JPEG_QUALITY`. */
export interface ConvertedJpeg {
  readonly blob: Blob;
  readonly mimeType: "image/jpeg";
}

/**
 * The injected browser edge for attach-time compression: a `File` in, a
 * (maybe) smaller JPEG out. Returns `null` when the source is not converted
 * (non-convertible format) or the conversion is skipped/failed (decode or
 * encode error, smaller-wins rule) — the caller then sends the original
 * bytes. Compression must never block or break sending, so every failure is
 * swallowed into `null`.
 */
export type ImageJpegEncoder = (file: File) => Promise<ConvertedJpeg | null>;

/**
 * Canvas-based JPEG re-encode: decode the source, rescale to cap the longest
 * edge at `MAX_IMAGE_EDGE_PX` (never upscale, high-quality smoothing), flatten
 * any transparency onto a white background (JPEG has no alpha), and encode at
 * `JPEG_QUALITY`. Applied only to convertible (lossless) sources; the result
 * is used only under the smaller-wins rule.
 *
 * Thin by design — every decision comes from `../logic/image-compress`.
 */
export const convertToJpeg: ImageJpegEncoder = async (file: File) => {
  try {
    if (!shouldConvertImage(file.type)) return null;

    const bitmap = await createImageBitmap(file);
    const target = computeResizedDimensions(bitmap.width, bitmap.height);

    const canvas = document.createElement("canvas");
    canvas.width = target.width;
    canvas.height = target.height;
    const ctx = canvas.getContext("2d");
    if (ctx === null) {
      bitmap.close();
      return null;
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    // Flatten transparency: JPEG has no alpha channel.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, target.width, target.height);
    ctx.drawImage(bitmap, 0, 0, target.width, target.height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY);
    });
    if (blob === null) return null;
    // Smaller-wins: keep the original when the re-encode didn't actually help.
    if (!useConvertedImage(file.size, blob.size)) return null;
    return { blob, mimeType: "image/jpeg" };
  } catch {
    // Decode/encode failure → the original image is sent untouched.
    return null;
  }
};
