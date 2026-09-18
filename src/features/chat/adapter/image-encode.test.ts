import { describe, expect, it } from "vitest";
import { convertToJpeg } from "./image-encode";

describe("convertToJpeg (canvas edge — real environment, no mocks)", () => {
  it("skips non-convertible formats without touching the canvas", async () => {
    const jpeg = new File([new Uint8Array([0xff, 0xd8])], "photo.jpg", { type: "image/jpeg" });
    await expect(convertToJpeg(jpeg)).resolves.toBe(null);
    const gif = new File([new Uint8Array([0x47])], "anim.gif", { type: "image/gif" });
    await expect(convertToJpeg(gif)).resolves.toBe(null);
    const unnamed = new File([new Uint8Array([0x00])], "blob", { type: "" });
    await expect(convertToJpeg(unnamed)).resolves.toBe(null);
  });

  it("falls back to null on decode failure (no real canvas in this environment)", async () => {
    const png = new File([new Uint8Array([0x89, 0x50])], "shot.png", { type: "image/png" });
    // jsdom has no `createImageBitmap` → the decode throws → the failure path
    // must resolve to `null` (never reject), so sending is never blocked.
    await expect(convertToJpeg(png)).resolves.toBe(null);
  });
});
