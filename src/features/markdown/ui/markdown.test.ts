import { fireEvent, render, screen } from "@testing-library/svelte";
import hljs from "highlight.js/lib/core";
import { describe, expect, it, vi } from "vitest";
import Markdown from "./Markdown.svelte";

describe("Markdown", () => {
  it("renders markdown into a .markdown-body container", () => {
    const { container } = render(Markdown, { props: { text: "# Hello\n\n**hi**" } });

    expect(container.querySelector(".markdown-body")).not.toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "Hello" })).toBeInTheDocument();
    expect(container.querySelector("strong")?.textContent).toBe("hi");
  });

  it("strips dangerous markup", () => {
    const { container } = render(Markdown, {
      props: { text: "before <script>alert(1)</script> after" },
    });

    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("before");
  });

  it("renders a copy button on a code block that copies the code to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    const { container } = render(Markdown, {
      props: { text: "```js\nconst x = 1;\n```" },
    });

    const button = container.querySelector<HTMLElement>("[data-copy]");
    expect(button).not.toBeNull();
    if (button === null) throw new Error("expected a copy button");

    await fireEvent.click(button);

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0]?.[0]).toContain("const x = 1;");
  });

  it("non-streaming renders a single container (today's full-render path)", () => {
    const { container } = render(Markdown, { props: { text: "# Hello" } });
    expect(container.querySelector(".markdown-stream-prefix")).toBeNull();
    expect(container.querySelector(".markdown-stream-tail")).toBeNull();
    // The rendered blocks are DIRECT children of .markdown-body (no wrappers).
    const body = container.querySelector(".markdown-body");
    expect(body?.querySelector("h1")).not.toBeNull();
    expect(body?.children[0]?.tagName).toBe("H1");
  });

  it("streaming renders the prefix/tail split with content matching the full render", () => {
    const { container } = render(Markdown, {
      props: { text: "# Hello\n\nsettled paragraph\n\ngrowing tail", streaming: true },
    });

    const prefix = container.querySelector<HTMLElement>(".markdown-stream-prefix");
    const tail = container.querySelector<HTMLElement>(".markdown-stream-tail");
    expect(prefix).not.toBeNull();
    expect(tail).not.toBeNull();
    // Same visible content as today's render, split across the two containers.
    expect(screen.getByRole("heading", { level: 1, name: "Hello" })).toBeInTheDocument();
    expect(container.textContent).toContain("growing tail");
    expect(prefix?.querySelector("h1")).not.toBeNull();
  });

  it("streaming: the settled prefix's html string identity is stable across text appends (no DOM churn)", async () => {
    const spy = vi.spyOn(hljs, "highlight");
    const { container, rerender } = render(Markdown, {
      props: { text: "intro\n\n```js\nconst x = 1;\n```\n\nafter", streaming: true },
    });

    const prefixBefore = container.querySelector(".markdown-stream-prefix")?.innerHTML;
    expect(prefixBefore).toContain("hljs-keyword"); // the closed fence settled, highlighted once
    expect(spy).toHaveBeenCalledTimes(1);

    // Appends that settle nothing leave the prefix string (and its DOM) alone.
    await rerender({ text: "intro\n\n```js\nconst x = 1;\n```\n\nafter and", streaming: true });
    await rerender({
      text: "intro\n\n```js\nconst x = 1;\n```\n\nafter and more",
      streaming: true,
    });
    expect(container.querySelector(".markdown-stream-prefix")?.innerHTML).toBe(prefixBefore);
    expect(spy).toHaveBeenCalledTimes(1); // still exactly one highlight
  });

  it("streaming: an open fence renders uncolored, then highlights exactly once when it closes", async () => {
    const spy = vi.spyOn(hljs, "highlight");
    const { container, rerender } = render(Markdown, {
      props: { text: "intro\n\n```js\nconst x", streaming: true },
    });

    const tail = container.querySelector<HTMLElement>(".markdown-stream-tail");
    expect(tail?.innerHTML).toContain("<pre><code");
    expect(tail?.innerHTML).toContain("data-copy"); // same copy button
    expect(tail?.innerHTML).not.toContain("hljs-keyword"); // uncolored while open
    expect(spy).not.toHaveBeenCalled();

    // Close the fence → highlighted EXACTLY once, settled into the prefix.
    await rerender({ text: "intro\n\n```js\nconst x = 1;\n```\n\ndone", streaming: true });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(container.querySelector(".markdown-stream-prefix")?.innerHTML).toContain("hljs-keyword");
  });

  it("streaming → done flips to the single-container full render (completion backstop)", async () => {
    const { container, rerender } = render(Markdown, {
      props: { text: "# Hello\n\nbody", streaming: true },
    });
    expect(container.querySelector(".markdown-stream-prefix")).not.toBeNull();

    await rerender({ text: "# Hello\n\nbody", streaming: false });
    expect(container.querySelector(".markdown-stream-prefix")).toBeNull();
    expect(container.querySelector(".markdown-stream-tail")).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "Hello" })).toBeInTheDocument();
  });

  it("streaming: the delegated copy-button listener still works for tail code blocks", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    const { container } = render(Markdown, {
      props: { text: "para\n\n```js\nconst y = 2;", streaming: true },
    });

    const button = container.querySelector<HTMLElement>("[data-copy]");
    expect(button).not.toBeNull();
    if (button === null) throw new Error("expected a copy button");
    await fireEvent.click(button);

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0]?.[0]).toContain("const y = 2;");
  });
});
