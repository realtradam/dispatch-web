import type { WorkspaceEntry } from "@dispatch/wire";
import { fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { geometryFor, type Placement } from "../logic/tile-layout";
import type { WorkspaceStore } from "../store.svelte";
import HomeTileGrid from "./HomeTileGrid.svelte";

const WIDE = geometryFor(1920, 1080);

function ws(overrides: Partial<WorkspaceEntry> = {}): WorkspaceEntry {
  return {
    id: "a",
    title: "Workspace A",
    defaultCwd: null,
    defaultComputerId: null,
    starred: false,
    createdAt: 1,
    lastActivityAt: 2,
    conversationCount: 1,
    ...overrides,
  };
}

function placement(id: string, col: number, row: number): Placement {
  return { id, col, row, colSpan: 1, rowSpan: 1 };
}

function fakeStore(): WorkspaceStore {
  return {
    rename: vi.fn(),
  } as unknown as WorkspaceStore;
}

function baseProps() {
  return {
    geometry: WIDE,
    workspacesById: new Map([
      ["a", ws()],
      ["b", ws({ id: "b", title: "Workspace B" })],
    ]),
    store: fakeStore(),
    onOpen: vi.fn(),
    onSelect: vi.fn(),
    onPlace: vi.fn(),
    onRenameEnd: vi.fn(),
  };
}

describe("HomeTileGrid", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders one tile per placement, positioned by the packed spans", () => {
    const props = baseProps();
    const { container } = render(HomeTileGrid, {
      props: {
        ...props,
        placements: [placement("a", 1, 1), placement("b", 2, 1)],
      },
    });

    expect(screen.getByRole("button", { name: "Open workspace Workspace A" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open workspace Workspace B" })).toBeInTheDocument();
    const wrappers = container.querySelectorAll("[data-tile-id]");
    expect(wrappers).toHaveLength(2);
    expect(wrappers[0]?.getAttribute("style")).toContain("grid-column: 1 / span 1");
    expect(wrappers[1]?.getAttribute("style")).toContain("grid-column: 2 / span 1");
  });

  it("a tap (press + release without moving) opens the workspace", async () => {
    const props = baseProps();
    render(HomeTileGrid, {
      props: { ...props, placements: [placement("a", 1, 1)] },
    });

    const wrapper = screen.getByRole("button", { name: "Open workspace Workspace A" });
    fireEvent.pointerDown(wrapper, { button: 0, clientX: 10, clientY: 10, pointerType: "mouse" });
    fireEvent.pointerUp(wrapper);

    expect(props.onOpen).toHaveBeenCalledWith("a");
    expect(props.onSelect).not.toHaveBeenCalled();
  });

  it("right-click selects the tile", async () => {
    const props = baseProps();
    render(HomeTileGrid, {
      props: { ...props, placements: [placement("a", 1, 1)] },
    });

    const wrapper = screen.getByRole("button", { name: "Open workspace Workspace A" });
    fireEvent.contextMenu(wrapper);

    expect(props.onSelect).toHaveBeenCalledWith("a");
    expect(props.onOpen).not.toHaveBeenCalled();
  });

  it("dragging shows the ghost + follow transform, and dropping PLACES at the hovered cell", async () => {
    const props = baseProps();
    const { container } = render(HomeTileGrid, {
      props: { ...props, placements: [placement("a", 1, 1), placement("b", 2, 1)] },
    });

    const wrapper = screen.getByRole("button", { name: "Open workspace Workspace A" });
    // The cell math resolves against the grid element's rect (jsdom: 0s).
    fireEvent.pointerDown(wrapper, { button: 0, clientX: 10, clientY: 10, pointerType: "mouse" });
    fireEvent.pointerMove(wrapper, { clientX: 80, clientY: 40 });

    // The dashed landing ghost appears…
    const ghost = container.querySelector("[aria-hidden='true'].border-dashed");
    expect(ghost).not.toBeNull();
    // …and the dragged tile itself follows the pointer (transform on the tile).
    const tile = container.querySelector("[data-tile-id='a']");
    expect(tile?.getAttribute("style")).toContain("translate(");

    fireEvent.pointerUp(wrapper);
    // The ghost + follow disappear on drop…
    expect(container.querySelector("[aria-hidden='true'].border-dashed")).toBeNull();
    // …and the drop committed a PLACE at the hovered cell (a lands where it
    // already was — the pointer hovered its own slot; a no-move drop).
    expect(props.onPlace).toHaveBeenCalledWith("a", { col: 1, row: 1 });
    // And no navigation either (a drag is not a tap).
    expect(props.onOpen).not.toHaveBeenCalled();
  });

  it("Escape mid-drag CANCELS: no place commits and the tile un-lifts", async () => {
    const props = baseProps();
    const { container } = render(HomeTileGrid, {
      props: { ...props, placements: [placement("a", 1, 1)] },
    });

    const wrapper = screen.getByRole("button", { name: "Open workspace Workspace A" });
    fireEvent.pointerDown(wrapper, { button: 0, clientX: 10, clientY: 10, pointerType: "mouse" });
    fireEvent.pointerMove(wrapper, { clientX: 80, clientY: 40 });

    fireEvent.keyDown(window, { key: "Escape" });

    expect(props.onPlace).not.toHaveBeenCalled();
    // The drag visuals are gone (the tile is no longer lifted).
    expect(container.querySelector("[aria-hidden='true'].border-dashed")).toBeNull();
  });

  it("a touch long-press lifts the tile and selects it (never opens)", async () => {
    const props = baseProps();
    render(HomeTileGrid, {
      props: { ...props, placements: [placement("a", 1, 1)] },
    });

    const wrapper = screen.getByRole("button", { name: "Open workspace Workspace A" });
    fireEvent.pointerDown(wrapper, {
      button: 0,
      clientX: 10,
      clientY: 10,
      pointerType: "touch",
    });
    await vi.advanceTimersByTimeAsync(500);

    expect(props.onSelect).toHaveBeenCalledWith("a");
    expect(props.onOpen).not.toHaveBeenCalled();
  });

  it("a touch drag that moves before the long-press cancels (scroll wins)", async () => {
    const props = baseProps();
    render(HomeTileGrid, {
      props: { ...props, placements: [placement("a", 1, 1)] },
    });

    const wrapper = screen.getByRole("button", { name: "Open workspace Workspace A" });
    fireEvent.pointerDown(wrapper, {
      button: 0,
      clientX: 10,
      clientY: 10,
      pointerType: "touch",
    });
    fireEvent.pointerMove(wrapper, { clientX: 10, clientY: 120 });
    await vi.advanceTimersByTimeAsync(500);

    expect(props.onSelect).not.toHaveBeenCalled();
    expect(props.onOpen).not.toHaveBeenCalled();
  });

  it("previews a transient span for the resizing tile", () => {
    const props = baseProps();
    const { container } = render(HomeTileGrid, {
      props: {
        ...props,
        placements: [placement("a", 1, 1)],
        preview: { id: "a", colSpan: 3, rowSpan: 2 },
      },
    });

    const wrapper = container.querySelector("[data-tile-id='a']");
    expect(wrapper?.getAttribute("style")).toContain("span 3");
    expect(wrapper?.getAttribute("style")).toContain("span 2");
  });
});
