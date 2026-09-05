import type { LayoutTree, SplitNode } from "@dispatch/layout-contract";
import { render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createCollapseStore, registerView, unregisterView } from "../index";
import FixtureA from "./fixtures/FixtureA.svelte";
import FixtureB from "./fixtures/FixtureB.svelte";
import FixtureC from "./fixtures/FixtureC.svelte";
import TileRoot from "./TileRoot.svelte";

// Fixture registry: two panel-eligible views + one content-only view (a THIRD
// component, so every fixture testid is unique in the rendered tree).
registerView({ id: "fix-a", label: "Alpha View", component: FixtureA });
registerView({ id: "fix-b", label: "Beta View", component: FixtureB });
registerView({ id: "fix-content", label: "Content", component: FixtureC, panelEligible: false });

function leaf(view: string): { kind: "leaf"; view: string } {
  return { kind: "leaf", view };
}

/** split[ stack[leaf a (grow), leaf content], collapsible panels[leaf b] ] */
function defaultTestTree(): LayoutTree {
  return {
    version: 1,
    root: {
      kind: "split",
      id: "root",
      dir: "row",
      children: [
        {
          size: 1,
          node: {
            kind: "stack",
            id: "main",
            children: [{ grow: 1, node: leaf("fix-a") }, { node: leaf("fix-content") }],
          },
        },
        {
          size: 0,
          basis: 320,
          collapsible: true,
          node: { kind: "panels", id: "side", panels: [leaf("fix-b")] },
        },
      ],
    },
  };
}

/** A bare panels root — panel EDITS without the collapsible chrome in the way. */
function panelsOnlyTree(...views: string[]): LayoutTree {
  return { version: 1, root: { kind: "panels", id: "side", panels: views.map(leaf) } };
}

/** The default test tree WITH the diagnostic markers on its two root tiles. */
function markedTestTree(): LayoutTree {
  return {
    version: 1,
    root: {
      kind: "split",
      id: "root",
      dir: "row",
      children: [
        {
          size: 1,
          node: {
            kind: "stack",
            id: "main",
            marker: "main",
            children: [{ grow: 1, node: leaf("fix-a") }],
          },
        },
        {
          size: 0,
          basis: 320,
          collapsible: true,
          node: { kind: "panels", id: "side", marker: "side", panels: [leaf("fix-b")] },
        },
      ],
    },
  };
}

function sidePanelsOf(tree: LayoutTree | null): string[] {
  if (tree === null) return [];
  const side = (tree.root as SplitNode).children?.[1]?.node;
  return side?.kind === "panels"
    ? side.panels.map((p) => p.view)
    : tree.root.kind === "panels"
      ? tree.root.panels.map((p) => p.view)
      : [];
}

describe("TileRoot", () => {
  it("renders every node kind: split, stack, panels, leaf", () => {
    // A FRESH collapse store per test — the store is stateful chrome.
    render(TileRoot, {
      props: { tree: defaultTestTree(), collapse: createCollapseStore({ viewportWidth: 1024 }) },
    });
    // Stack children mount their registered components.
    expect(screen.getByTestId("fixture-a")).toBeInTheDocument();
    expect(screen.getByTestId("fixture-c")).toBeInTheDocument();
    // The panels node renders its panel leaf + the dropdown.
    expect(screen.getByTestId("fixture-b")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Select a view" })).toBeInTheDocument();
  });

  it("shows a fallback tile (never a crash) for an unknown view id", () => {
    const tree: LayoutTree = {
      version: 1,
      root: { kind: "leaf", view: "not-registered-anywhere" },
    };
    render(TileRoot, { props: { tree, collapse: createCollapseStore() } });
    const fallback = screen.getByTestId("fallback-tile");
    expect(fallback).toHaveTextContent("not-registered-anywhere");
    expect(fallback).toHaveTextContent("View not registered.");
  });

  it("renders nothing for the titlebar slot while it is unset (D-L5)", () => {
    const { container } = render(TileRoot, {
      props: { tree: defaultTestTree(), collapse: createCollapseStore() },
    });
    expect(container.querySelectorAll("[data-testid='fallback-tile']")).toHaveLength(0);
  });

  it("a set titlebar renders its node (the slot works; nothing populates it today)", () => {
    const tree: LayoutTree = {
      version: 1,
      titlebar: { kind: "leaf", view: "fix-a" },
      root: { kind: "leaf", view: "fix-b" },
    };
    render(TileRoot, { props: { tree, collapse: createCollapseStore() } });
    expect(screen.getByTestId("fixture-a")).toBeInTheDocument();
    expect(screen.getByTestId("fixture-b")).toBeInTheDocument();
  });

  it("the collapsible child reflects the collapse store and toggles through it", async () => {
    const collapse = createCollapseStore({ viewportWidth: 1024 });
    const { container } = render(TileRoot, { props: { tree: defaultTestTree(), collapse } });
    const aside = container.querySelector<HTMLElement>("[data-testid='collapsible-child']");
    expect(aside).not.toBeNull();
    // Wide viewport default: open → full basis width.
    expect(aside).toHaveAttribute("data-open", "true");
    expect(aside?.style.width).toBe("320px");

    await collapse.toggle("side");
    expect(aside).toHaveAttribute("data-open", "false");
    expect(aside?.style.width).toBe("0px");
  });

  it("a dropdown swap emits replaceView and the owner receives the changed tree", async () => {
    const user = userEvent.setup();
    let changed: LayoutTree | null = null;
    render(TileRoot, {
      props: {
        tree: panelsOnlyTree("fix-b"),
        collapse: createCollapseStore(),
        onTreeChange: (t) => (changed = t),
      },
    });

    await user.selectOptions(screen.getByRole("combobox", { name: "Select a view" }), "fix-a");
    expect(sidePanelsOf(changed)).toEqual(["fix-a"]);
    // TileRoot is a CONTROLLED component: applying the op is the owner's job
    // (App re-renders with the new tree; the test doesn't feed it back).
  });

  it("the + button emits insertPanel pre-selecting the first eligible view", async () => {
    const user = userEvent.setup();
    let changed: LayoutTree | null = null;
    render(TileRoot, {
      props: {
        tree: panelsOnlyTree("fix-b"),
        collapse: createCollapseStore(),
        onTreeChange: (t) => (changed = t),
      },
    });

    await user.click(screen.getByRole("button", { name: "Add view" }));
    expect(sidePanelsOf(changed)).toEqual(["fix-b", "fix-a"]);
  });

  it("the ✕ button emits removeNode for that panel (absent on the first panel)", async () => {
    const user = userEvent.setup();
    let changed: LayoutTree | null = null;
    render(TileRoot, {
      props: {
        tree: panelsOnlyTree("fix-b", "fix-a"),
        collapse: createCollapseStore(),
        onTreeChange: (t) => (changed = t),
      },
    });

    // Only panels after the first can be removed — like ViewSidebar today.
    const removeButtons = screen.getAllByRole("button", { name: "Remove view" });
    expect(removeButtons).toHaveLength(1);
    await user.click(removeButtons[0] as HTMLElement);
    expect(sidePanelsOf(changed)).toEqual(["fix-b"]);
  });

  it("an invalid edit is refused: the first panel has no remove button", () => {
    const tree = panelsOnlyTree("fix-b");
    let changed: LayoutTree | null = null;
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      render(TileRoot, {
        props: { tree, collapse: createCollapseStore(), onTreeChange: (t) => (changed = t) },
      });
      expect(screen.queryByRole("button", { name: "Remove view" })).toBeNull();
      expect(changed).toBeNull();
    } finally {
      consoleError.mockRestore();
    }
  });

  it("a stack child with grow renders in a flex-grown wrapper; others natural", () => {
    const { container } = render(TileRoot, {
      props: { tree: defaultTestTree(), collapse: createCollapseStore() },
    });
    const grown = container.querySelector("[data-testid='fixture-a']")?.closest(".min-h-0");
    expect(grown?.getAttribute("style")).toContain("flex: 1 1 0%");
    const natural = container.querySelector("[data-testid='fixture-c']")?.closest(".min-h-0");
    expect(natural?.getAttribute("style")).toContain("flex: 0 0 auto");
  });

  it("the stack column is full-height so a grow child fills it even when empty", () => {
    // jsdom can't compute flex layout — the honest seam is the CSS class.
    // WITHOUT `h-full` the stack column's height is content-based, so the
    // grow child's `flex: 1 1 0%` has no space to fill: an EMPTY chat leaf
    // collapses to ~0 and the composer below it rides to the top (instead of
    // staying pinned at the bottom of the column).
    const { container } = render(TileRoot, {
      props: { tree: defaultTestTree(), collapse: createCollapseStore() },
    });
    const stackColumn = container.querySelector("[data-testid='fixture-a']")?.closest(".flex-col");
    expect(stackColumn).toHaveClass("h-full");
  });

  it("a marked stack/panels node draws its diagnostic outline (main red, side green)", () => {
    // The inline outline IS the honest seam: marker values arrive in runtime
    // tree data (Tailwind can't see them — dynamic classes would silently
    // render nothing), so the renderer applies an inline style, and the test
    // asserts exactly what lands on the tile wrapper.
    const { container } = render(TileRoot, {
      props: { tree: markedTestTree(), collapse: createCollapseStore({ viewportWidth: 1024 }) },
    });
    const stack = container.querySelector("[data-testid='fixture-a']")?.closest(".flex-col");
    expect(stack?.getAttribute("style")).toContain("outline: 4px solid red");
    const panels = container.querySelector("[data-testid='fixture-b']")?.closest(".gap-2");
    expect(panels?.getAttribute("style")).toContain("outline: 4px solid green");
  });

  it("an unmarked tree draws NO outlines (trees without the field render exactly as before)", () => {
    const { container } = render(TileRoot, {
      props: { tree: defaultTestTree(), collapse: createCollapseStore() },
    });
    expect(container.querySelectorAll("[style*='outline']")).toHaveLength(0);
  });

  it("an unknown marker value draws nothing (the renderer ignores what it doesn't know)", () => {
    // Both root tiles marked with a value the renderer doesn't know.
    const tree = markedTestTree();
    const root = tree.root;
    if (root.kind !== "split") return;
    const junked = root.children.map((child) => ({
      ...child,
      node: { ...child.node, marker: "purple" } as unknown as typeof child.node,
    }));
    const marked: LayoutTree = { version: 1, root: { ...root, children: junked } };
    const { container } = render(TileRoot, {
      props: { tree: marked, collapse: createCollapseStore({ viewportWidth: 1024 }) },
    });
    expect(container.querySelectorAll("[style*='outline']")).toHaveLength(0);
  });

  it("a marked LEAF draws its outline around a wrapper (the only wrapperless node kind)", () => {
    const tree: LayoutTree = {
      version: 1,
      root: { kind: "leaf", view: "fix-a", marker: "side" },
    };
    const { container } = render(TileRoot, { props: { tree, collapse: createCollapseStore() } });
    const fixture = container.querySelector("[data-testid='fixture-a']");
    expect(fixture?.parentElement?.getAttribute("style")).toContain("outline: 4px solid green");
  });

  it("the dropdown lists panel-eligible views only (decision 5)", () => {
    render(TileRoot, { props: { tree: panelsOnlyTree("fix-b"), collapse: createCollapseStore() } });
    const select = screen.getByRole("combobox", { name: "Select a view" });
    const labels = [...select.querySelectorAll("option")].map((o) => o.textContent);
    expect(labels).toContain("Alpha View");
    expect(labels).toContain("Beta View");
    expect(labels).not.toContain("Content");
  });

  it("an unregistered view id inside a panel renders the fallback (not a crash)", () => {
    render(TileRoot, {
      props: { tree: panelsOnlyTree("ghost-view"), collapse: createCollapseStore() },
    });
    expect(screen.getByTestId("fallback-tile")).toBeInTheDocument();
  });
});

describe("TileRoot registry cleanup", () => {
  it("unregisters the fixture views (the registry is module-global per test file)", () => {
    unregisterView("fix-a");
    unregisterView("fix-b");
    unregisterView("fix-content");
    const tree: LayoutTree = { version: 1, root: { kind: "leaf", view: "fix-a" } };
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      render(TileRoot, { props: { tree, collapse: createCollapseStore() } });
      // Unregistered → the fallback tile, not a crash.
      expect(screen.getByTestId("fallback-tile")).toBeInTheDocument();
    } finally {
      consoleError.mockRestore();
    }
  });
});
