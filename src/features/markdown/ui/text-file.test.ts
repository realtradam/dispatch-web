import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import { createTextFileClient } from "../adapter/text-file";
import Markdown from "./Markdown.svelte";

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const context = { conversationId: "c", cwd: "/project", computerId: null };
function fixture(text: string, format: "markdown" | "text" = "markdown") {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) =>
    json(
      String(url).endsWith("-context")
        ? context
        : {
            path: "/project/notes/plan.md",
            text,
            format,
            bytes: new TextEncoder().encode(text).length,
            maxBytes: 262144,
          },
    ),
  );
  return { fetcher, client: createTextFileClient("/api", "c", fetcher) };
}
describe("rendered live text-file embeds", () => {
  it("renders Markdown head/tail source lines and expands/collapses the full sanitized document", async () => {
    const text = Array.from({ length: 20 }, (_, i) => `## Line ${i + 1}`).join("\n");
    const { client, fetcher } = fixture(text);
    const { unmount } = render(Markdown, {
      text: "Summary\n\n[Plan](text-file:notes/plan.md)",
      textFiles: client,
    });
    expect(screen.getByRole("status")).toHaveTextContent("Loading text file");
    await screen.findByRole("heading", { name: "Line 1" });
    expect(screen.getByRole("heading", { name: "Line 6" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Line 15" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Line 20" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Line 10" })).not.toBeInTheDocument();
    expect(screen.getByText(/8 source lines omitted/)).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "Expand document" }));
    expect(screen.getByRole("heading", { name: "Line 10" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Collapse document" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await fireEvent.click(screen.getByRole("button", { name: "Collapse document" }));
    expect(screen.queryByRole("heading", { name: "Line 10" })).not.toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledTimes(2);
    unmount();
    client.dispose();
  });
  it("short documents don't duplicate; nested embeds are inert; HTML stays sanitized and remote images require consent", async () => {
    const text =
      '# Short\n\n[nested](text-file:secret.md)\n\n<script>alert(1)</script><img src="https://evil.example/a.png" onerror="alert(1)">\n\n[bad](javascript:alert(1))';
    const { client, fetcher } = fixture(text);
    const { container, unmount } = render(Markdown, {
      text: "[Plan](text-file:notes/plan.md)",
      textFiles: client,
    });
    await screen.findByRole("heading", { name: "Short" });
    expect(screen.getAllByRole("heading", { name: "Short" })).toHaveLength(1);
    expect(
      container.querySelector("script,[onerror],a[href^='javascript:'],a[href^='text-file:'],img"),
    ).toBeNull();
    expect(container.textContent).toContain("nested");
    await fireEvent.click(screen.getByRole("button", { name: "Expand document" }));
    await fireEvent.click(screen.getByRole("button", { name: "Load image from evil.example" }));
    expect(container.querySelector("img")?.getAttribute("src")).toBe("https://evil.example/a.png");
    expect(fetcher).toHaveBeenCalledTimes(2);
    unmount();
    client.dispose();
  });
  it("does not render omitted images before expansion; restores tail fence context", async () => {
    const text =
      "# Head\n\n1\n2\n3\n4\n![hidden](https://hidden.example/a.png)\n```js\n" +
      Array.from({ length: 20 }, () => 'const x = "safe";').join("\n") +
      "\n```";
    const { client } = fixture(text);
    const { container, unmount } = render(Markdown, {
      text: "[Plan](text-file:a.md)",
      textFiles: client,
    });
    await screen.findByRole("heading", { name: "Head" });
    expect(
      screen.queryByRole("button", { name: "Load image from hidden.example" }),
    ).not.toBeInTheDocument();
    expect(container.querySelector("code.language-js")).not.toBeNull();
    await fireEvent.click(screen.getByRole("button", { name: "Expand document" }));
    expect(
      screen.getByRole("button", { name: "Load image from hidden.example" }),
    ).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
    unmount();
    client.dispose();
  });
  it("renders plain text with safe whitespace and no Markdown/HTML interpretation", async () => {
    const { client } = fixture("# heading\n  <script>bad</script>\n\tlast", "text");
    const { container, unmount } = render(Markdown, {
      text: "[Text](text-file:a.txt)",
      textFiles: client,
    });
    await waitFor(() =>
      expect(container.querySelector("pre code")?.textContent).toBe(
        "# heading\n  <script>bad</script>\n\tlast",
      ),
    );
    expect(container.querySelector("script,h1")).toBeNull();
    unmount();
    client.dispose();
  });
  it("empty, error, Retry and Refresh states reread rather than insert file text into source", async () => {
    const { client, fetcher } = fixture("");
    fetcher
      .mockResolvedValueOnce(json(context))
      .mockResolvedValueOnce(json({ error: "Missing file" }, 404));
    const { unmount } = render(Markdown, { text: "[Plan](text-file:a.md)", textFiles: client });
    expect(await screen.findByRole("alert")).toHaveTextContent("Missing file");
    await fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByText("Empty file");
    await fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await screen.findByText("Empty file");
    expect(fetcher).toHaveBeenCalledTimes(6);
    unmount();
    client.dispose();
  });
  it("never fetches without opt-in, for incomplete streaming, code or forged raw HTML", async () => {
    const { client, fetcher } = fixture("body");
    const { rerender, unmount } = render(Markdown, { text: "[Plan](text-file:a.md)" });
    await rerender({
      text: '<div data-text-file="secret.md"><button data-path="secret.md">Fake</button></div>\n\n`[Plan](text-file:a.md)`\n\n```\n[Plan](text-file:a.md)\n```',
      textFiles: client,
    });
    await rerender({ text: "[Plan](text-file:a.md)", streaming: true, textFiles: client });
    expect(fetcher).not.toHaveBeenCalled();
    await rerender({ text: "[Plan](text-file:a.md)\n\ntail", streaming: true, textFiles: client });
    await screen.findByText("body");
    await rerender({
      text: "[Plan](text-file:a.md)\n\ntail growing",
      streaming: true,
      textFiles: client,
    });
    await rerender({
      text: "[Plan](text-file:a.md)\n\ntail growing",
      streaming: false,
      textFiles: client,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    unmount();
    client.dispose();
  });
  it("ignores old conversation results after the context-bound client changes", async () => {
    let finish: (r: Response) => void = () => {};
    const old = fixture("old");
    old.fetcher.mockResolvedValueOnce(json(context)).mockImplementationOnce(
      () =>
        new Promise((r) => {
          finish = r;
        }),
    );
    const next = fixture("new");
    const { rerender, unmount } = render(Markdown, {
      text: "[Plan](text-file:a.md)",
      textFiles: old.client,
    });
    await waitFor(() => expect(old.fetcher).toHaveBeenCalledTimes(2));
    await rerender({ text: "[Plan](text-file:a.md)", textFiles: next.client });
    await screen.findByText("new");
    finish(
      json({ path: "/old/a.md", text: "old", format: "markdown", bytes: 3, maxBytes: 262144 }),
    );
    await waitFor(() => expect(screen.queryByText("old")).not.toBeInTheDocument());
    expect(old.fetcher.mock.calls[1]?.[1]?.signal?.aborted).toBe(true);
    unmount();
    old.client.dispose();
    next.client.dispose();
  });
  it("deduplicates repeated blocks without replacing them on per-token appends", async () => {
    const { client, fetcher } = fixture("# shared");
    const text = "[one](text-file:a.md)\n\n[two](text-file:a.md)\n\n";
    const { rerender, unmount } = render(Markdown, { text, streaming: true, textFiles: client });
    await waitFor(() => expect(screen.getAllByRole("heading", { name: "shared" })).toHaveLength(2));
    await fireEvent.click(
      screen.getAllByRole("button", { name: "Expand document" })[0] as HTMLElement,
    );
    await rerender({ text: `${text}growing`, streaming: true, textFiles: client });
    expect(screen.getByRole("button", { name: "Collapse document" })).toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledTimes(2);
    unmount();
    client.dispose();
  });
});
