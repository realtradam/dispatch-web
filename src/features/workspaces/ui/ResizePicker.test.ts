import { render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { geometryFor } from "../logic/tile-layout";
import ResizePicker from "./ResizePicker.svelte";

const WIDE = geometryFor(1920, 1080);
const TALL = geometryFor(390, 844);

function props() {
  return {
    onPreview: vi.fn(),
    onCommit: vi.fn(),
    onCancel: vi.fn(),
  };
}

describe("ResizePicker", () => {
  it("renders one small square per cap (4×2 wide, 2×2 tall)", () => {
    const p = props();
    const wide = render(ResizePicker, {
      props: { geometry: WIDE, initial: { colSpan: 1, rowSpan: 1 }, ...p },
    });
    expect(screen.getAllByRole("button")).toHaveLength(8);
    wide.unmount();

    render(ResizePicker, {
      props: { geometry: TALL, initial: { colSpan: 1, rowSpan: 1 }, ...p },
    });
    expect(screen.getAllByRole("button")).toHaveLength(4);
  });

  it("hovering square (r, c) previews that rectangle", async () => {
    const user = userEvent.setup();
    const p = props();
    render(ResizePicker, {
      props: { geometry: WIDE, initial: { colSpan: 1, rowSpan: 1 }, ...p },
    });

    await user.hover(screen.getByRole("button", { name: "Resize to 3 by 2" }));
    expect(p.onPreview).toHaveBeenCalledWith({ colSpan: 3, rowSpan: 2 });
  });

  it("clicking a square commits that size", async () => {
    const user = userEvent.setup();
    const p = props();
    render(ResizePicker, {
      props: { geometry: WIDE, initial: { colSpan: 1, rowSpan: 1 }, ...p },
    });

    await user.click(screen.getByRole("button", { name: "Resize to 2 by 1" }));
    expect(p.onCommit).toHaveBeenCalledWith(2, 1);
  });

  it("arrow keys move within the picker, Enter commits, Escape cancels", async () => {
    const user = userEvent.setup();
    const p = props();
    render(ResizePicker, {
      props: { geometry: WIDE, initial: { colSpan: 2, rowSpan: 1 }, ...p },
    });

    await user.keyboard("{ArrowRight}");
    expect(p.onPreview).toHaveBeenLastCalledWith({ colSpan: 3, rowSpan: 1 });
    await user.keyboard("{ArrowDown}");
    expect(p.onPreview).toHaveBeenLastCalledWith({ colSpan: 3, rowSpan: 2 });
    await user.keyboard("{ArrowLeft}");
    expect(p.onPreview).toHaveBeenLastCalledWith({ colSpan: 2, rowSpan: 2 });

    await user.keyboard("{Enter}");
    expect(p.onCommit).toHaveBeenCalledWith(2, 2);
    expect(p.onCancel).not.toHaveBeenCalled();

    await user.keyboard("{Escape}");
    expect(p.onCancel).toHaveBeenCalledTimes(1);
  });

  it("leaving the picker clears the preview", async () => {
    const user = userEvent.setup();
    const p = props();
    render(ResizePicker, {
      props: { geometry: WIDE, initial: { colSpan: 1, rowSpan: 1 }, ...p },
    });

    await user.hover(screen.getByRole("button", { name: "Resize to 4 by 2" }));
    await user.unhover(screen.getByRole("button", { name: "Resize to 4 by 2" }));
    expect(p.onPreview).toHaveBeenLastCalledWith(null);
  });
});
