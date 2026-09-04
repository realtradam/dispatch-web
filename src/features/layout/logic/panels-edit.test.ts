import { describe, expect, it } from "vitest";
import { addPanelOp, firstPanelView, removePanelOp, swapPanelOp } from "./panels-edit";

describe("panel edit → op mapping", () => {
  it("maps a dropdown swap to a replaceView on the panel leaf's path", () => {
    expect(swapPanelOp([1], 2, "model")).toEqual({
      type: "replaceView",
      target: [1, 2],
      view: "model",
    });
  });

  it("maps the + button to an append insertPanel", () => {
    expect(addPanelOp(["titlebar"], "tasks")).toEqual({
      type: "insertPanel",
      panels: ["titlebar"],
      view: "tasks",
    });
  });

  it("maps the ✕ button to a removeNode on the panel leaf's path", () => {
    expect(removePanelOp([1], 0)).toEqual({ type: "removeNode", target: [1, 0] });
  });

  it("the + button pre-selects the first eligible view (or null when none)", () => {
    expect(firstPanelView([{ id: "tabs" }, { id: "model" }])).toBe("tabs");
    expect(firstPanelView([])).toBeNull();
  });
});
