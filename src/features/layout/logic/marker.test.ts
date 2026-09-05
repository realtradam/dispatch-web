import { describe, expect, it } from "vitest";
import { markerOutline } from "./marker";

describe("markerOutline — the diagnostic tile-border mapping", () => {
  it("main → a 4px solid red outline (the main tile's marker)", () => {
    expect(markerOutline("main")).toBe("4px solid red");
  });

  it("side → a 4px solid green outline (the side tile's marker)", () => {
    expect(markerOutline("side")).toBe("4px solid green");
  });

  it("no marker → no outline (existing trees render exactly as before)", () => {
    expect(markerOutline(undefined)).toBeUndefined();
  });
});
