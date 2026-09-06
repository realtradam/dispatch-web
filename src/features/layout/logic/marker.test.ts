import type { TileMarker } from "@dispatch/layout-contract";
import { describe, expect, it } from "vitest";
import { markerOutline, markerStyle } from "./marker";

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

describe("markerStyle — the complete inline style (outline + inset offset)", () => {
  it("insets the outline so it draws INSIDE the tile's box (never clipped at screen edges)", () => {
    expect(markerStyle("main")).toBe("outline: 4px solid red; outline-offset: -4px");
    expect(markerStyle("side")).toBe("outline: 4px solid green; outline-offset: -4px");
  });

  it("no/unknown marker → NO style at all (unmarked nodes carry zero outline CSS)", () => {
    expect(markerStyle(undefined)).toBeUndefined();
    expect(markerStyle("purple" as unknown as TileMarker)).toBeUndefined();
  });
});
