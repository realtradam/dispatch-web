import { afterEach, describe, expect, it } from "vitest";
import { portal } from "./portal";

describe("portal action", () => {
  afterEach(() => {
    // Strip any leftover teleported nodes between tests.
    document.querySelectorAll("body > :not(script)").forEach((n) => {
      if (n instanceof HTMLElement) n.remove();
    });
  });

  it("teleports the node to document.body (escaping an ancestor with transform)", () => {
    // Simulate the sidebar: a transformed ancestor establishes a containing
    // block for `position: fixed`.
    const ancestor = document.createElement("div");
    ancestor.style.transform = "translateX(0)";
    document.body.appendChild(ancestor);

    const node = document.createElement("div");
    node.setAttribute("data-testid", "modal");
    ancestor.appendChild(node);
    expect(node.parentNode).toBe(ancestor);

    const action = portal(node);

    // After the action, the node is a direct child of <body>, not the ancestor.
    expect(node.parentNode).toBe(document.body);
    expect(ancestor.contains(node)).toBe(false);

    action.destroy();

    // On destroy the node is removed from <body>.
    expect(document.body.contains(node)).toBe(false);
  });

  it("is a no-op (does not throw) when document is unavailable (SSR guard)", () => {
    const originalDocument = globalThis.document;
    // @ts-expect-error — deliberately undefined to exercise the SSR guard.
    globalThis.document = undefined;
    try {
      const stub = {} as HTMLElement;
      const action = portal(stub);
      // Must not throw, and returns a destroy that is safe to call.
      action.destroy();
    } finally {
      globalThis.document = originalDocument;
    }
  });
});
