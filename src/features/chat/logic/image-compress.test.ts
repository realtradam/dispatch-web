import { describe, expect, it } from "vitest";
import {
  computeResizedDimensions,
  MAX_IMAGE_EDGE_PX,
  shouldConvertImage,
  useConvertedImage,
} from "./image-compress";

describe("shouldConvertImage", () => {
  it("converts lossless sources (PNG, BMP)", () => {
    expect(shouldConvertImage("image/png")).toBe(true);
    expect(shouldConvertImage("image/bmp")).toBe(true);
  });

  it("skips already-lossy and animated formats", () => {
    expect(shouldConvertImage("image/jpeg")).toBe(false);
    expect(shouldConvertImage("image/webp")).toBe(false);
    expect(shouldConvertImage("image/gif")).toBe(false);
  });

  it("leaves unknown or absent MIME types alone", () => {
    expect(shouldConvertImage(undefined)).toBe(false);
    expect(shouldConvertImage("")).toBe(false);
    expect(shouldConvertImage("image/tiff")).toBe(false);
    expect(shouldConvertImage("image/svg+xml")).toBe(false);
  });
});

describe("computeResizedDimensions", () => {
  it("never upscales a source already within the cap", () => {
    expect(computeResizedDimensions(100, 50)).toEqual({ width: 100, height: 50 });
    expect(computeResizedDimensions(2048, 1024)).toEqual({ width: 2048, height: 1024 });
    expect(computeResizedDimensions(640, 640)).toEqual({ width: 640, height: 640 });
  });

  it("caps the longest edge at 2048", () => {
    expect(computeResizedDimensions(4096, 2048)).toEqual({ width: 2048, height: 1024 });
    expect(computeResizedDimensions(8192, 4096)).toEqual({ width: 2048, height: 1024 });
  });

  it("caps the longest edge regardless of orientation (portrait)", () => {
    expect(computeResizedDimensions(2000, 3000)).toEqual({ width: 1365, height: 2048 });
  });

  it("preserves aspect ratio on the rescale", () => {
    const { width, height } = computeResizedDimensions(3000, 2000);
    expect(width).toBe(2048);
    // 2000 * (2048/3000) = 1365.33… → 1365
    expect(height).toBe(1365);
    expect(width / height).toBeCloseTo(3000 / 2000, 2);
  });

  it("handles extreme aspect ratios without exceeding the cap", () => {
    expect(computeResizedDimensions(5000, 10)).toEqual({ width: 2048, height: 4 });
    expect(computeResizedDimensions(10, 5000)).toEqual({ width: 4, height: 2048 });
  });

  it("honors a custom cap", () => {
    expect(computeResizedDimensions(1000, 500, 250)).toEqual({ width: 250, height: 125 });
  });

  it("uses the default 2048px cap constant", () => {
    expect(MAX_IMAGE_EDGE_PX).toBe(2048);
  });
});

describe("useConvertedImage", () => {
  it("uses the conversion only when it is strictly fewer bytes", () => {
    expect(useConvertedImage(3_000_000, 300_000)).toBe(true);
  });

  it("keeps the original when equal or larger", () => {
    expect(useConvertedImage(300_000, 300_000)).toBe(false);
    expect(useConvertedImage(100_000, 300_000)).toBe(false);
  });
});
