import { describe, expect, it } from "vitest";
import { stopButtonLabels } from "./composer";

describe("stopButtonLabels", () => {
  it.each([undefined, 0])("preserves plain Stop with queued count %s", (count) => {
    expect(stopButtonLabels(count)).toEqual({
      text: "Stop",
      ariaLabel: "Stop generation",
      title: undefined,
    });
  });

  it.each([1, 2])("describes interrupt-and-send with queued count %s", (count) => {
    expect(stopButtonLabels(count)).toEqual({
      text: "Interrupt & send queued",
      ariaLabel: "Interrupt & send queued",
      title: "Stop the current response and start the queued message now",
    });
  });
});
