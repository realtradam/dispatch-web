import { describe, expect, it } from "vitest";
import { resolveImageUrl } from "./image-url";

const BASE = "http://localhost:24203";

describe("resolveImageUrl", () => {
  it("returns a data URL as-is (the optimistic echo / a pasted image)", () => {
    const dataUrl = "data:image/png;base64,iVBORw0KGgo=";
    expect(resolveImageUrl(dataUrl, BASE)).toBe(dataUrl);
  });

  it("returns an absolute http URL as-is", () => {
    const abs = "https://example.com/img.png";
    expect(resolveImageUrl(abs, BASE)).toBe(abs);
  });

  it("prepends the api base to a relative /images/ path", () => {
    expect(resolveImageUrl("/images/conv-123/abc-456.png", BASE)).toBe(
      "http://localhost:24203/images/conv-123/abc-456.png",
    );
  });

  it("does not double the slash when the base has a trailing slash", () => {
    expect(resolveImageUrl("/images/c/x.png", "http://localhost:24203/")).toBe(
      "http://localhost:24203/images/c/x.png",
    );
  });

  it("adds a leading slash to a path-relative url without one", () => {
    expect(resolveImageUrl("images/c/x.png", BASE)).toBe("http://localhost:24203/images/c/x.png");
  });

  it("returns the relative path as-is when apiBase is empty (root-relative)", () => {
    // A browser resolves a root-relative `/images/…` against the document origin.
    expect(resolveImageUrl("/images/c/x.png", "")).toBe("/images/c/x.png");
  });

  it("handles a relative path with an empty apiBase (path-relative without slash)", () => {
    expect(resolveImageUrl("images/c/x.png", "")).toBe("/images/c/x.png");
  });

  it("returns a data URL as-is even with an empty apiBase", () => {
    const dataUrl = "data:image/jpeg;base64,AAAA";
    expect(resolveImageUrl(dataUrl, "")).toBe(dataUrl);
  });
});
