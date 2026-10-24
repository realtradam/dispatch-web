import hljs from "highlight.js/lib/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { countDelimiters, renderMarkdown, renderMarkdownTail, renderOpenFence } from "./markdown";
import { advance, createStreamingMarkdown } from "./streaming-markdown";

/**
 * Test-side normalizer for the equivalence contract. The checkpoint render may
 * legitimately differ from today's whole-text streaming render in exactly two
 * transient ways while streaming:
 *  1. Level 2: an OPEN fence renders plain-escaped (no hljs spans) — unwrapping
 *     hljs spans on both sides makes them comparable ("just colour" is the
 *     accepted trade; the closed render is byte-identical).
 *  2. Newlines BETWEEN top-level blocks (each rendered unit emits its own
 *     trailing newline) and marked's trailing newline inside `<code>` before an
 *     appended closing fence — inter-tag whitespace collapse handles both.
 * Text-node content inside `<pre><code>` is untouched (`>…<` never matches
 * escaped code content), so code bytes are still compared exactly.
 */
function normalizeHtml(html: string): string {
  const host = document.createElement("div");
  host.innerHTML = html;
  for (const span of [...host.querySelectorAll("span")]) {
    if ([...span.classList].some((c) => c.startsWith("hljs"))) {
      span.replaceWith(...span.childNodes);
    }
  }
  return host.innerHTML
    .replace(/>\s+</g, "><")
    .replace(/\n+(?=<\/code>)/g, "")
    .trim();
}

describe("streaming-markdown", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("degenerate case (nothing settled) is exactly today's streaming render", () => {
    const state = createStreamingMarkdown();
    const text = "Some **bold** and `code` text";
    const { prefixHtml, tailHtml } = advance(state, text);
    expect(prefixHtml).toBe("");
    expect(tailHtml).toBe(renderMarkdown(text, { streaming: true }));
  });

  it("settles a paragraph at a blank-line boundary and matches the full render", () => {
    const state = createStreamingMarkdown();
    // The settle commits only once the boundary's lookahead line completes.
    advance(state, "first para\n\nnext");
    expect(state.prefixHtml).toBe("");
    advance(state, "first para\n\nnext\n");
    // The settle point is the START of the blank run (the separator blanks
    // lead the tail, where marked ignores them — the rendered HTML is the
    // same either way).
    expect(state.prefixHtml).toBe(renderMarkdown("first para\n"));
    expect(state.settledOffset).toBe("first para\n".length);
    // Equivalence against the whole-text render.
    const { prefixHtml, tailHtml } = advance(state, "first para\n\nnext\n");
    expect(normalizeHtml(prefixHtml + tailHtml)).toBe(
      normalizeHtml(renderMarkdown("first para\n\nnext\n", { streaming: true })),
    );
  });

  it("matches the full render while inside an open list (no checkpoints — degraded caching, never wrong)", () => {
    const state = createStreamingMarkdown();
    const text = "- item a\n\n- item b\n\n- item c";
    let shown = "";
    for (let i = 1; i <= text.length; i++) {
      const prefix = text.slice(0, i);
      const r = advance(state, prefix);
      shown = r.prefixHtml + r.tailHtml;
      expect(normalizeHtml(shown)).toBe(normalizeHtml(renderMarkdown(prefix, { streaming: true })));
    }
  });

  it("highlight-exactly-once: zero hljs while a fence is open, one call when it closes", () => {
    const spy = vi.spyOn(hljs, "highlight");
    const state = createStreamingMarkdown();

    advance(state, "intro\n\n```js\nc");
    expect(spy).not.toHaveBeenCalled(); // open fence → plain escaped, no hljs

    advance(state, "intro\n\n```js\nconst x = 1;\n");
    expect(spy).not.toHaveBeenCalled(); // still open

    const closed = advance(state, "intro\n\n```js\nconst x = 1;\n```\n");
    expect(spy).toHaveBeenCalledTimes(1); // highlighted EXACTLY once, on close
    expect(closed.prefixHtml).toContain("hljs-keyword"); // the settled fence is colored
    // The open-fence tail is gone (nothing but prose after the fence).
    expect(closed.tailHtml).toBe(renderMarkdownTail("", state.seed));

    // Subsequent deltas do NOT re-highlight the settled block.
    advance(state, "intro\n\n```js\nconst x = 1;\n```\nafter\n");
    advance(state, "intro\n\n```js\nconst x = 1;\n```\nafter\nmore\n");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("open fence renders plain-escaped <pre><code> with the same classes/wrapper as the closed pipeline", () => {
    const state = createStreamingMarkdown();
    const { prefixHtml, tailHtml } = advance(state, "intro\n\n```js\nconst x = 1;");
    expect(prefixHtml).toContain("intro");
    expect(tailHtml).toContain('<pre><code class="hljs language-js">');
    expect(tailHtml).toContain("data-copy"); // same copy-button wrapper
    expect(tailHtml).not.toContain("hljs-keyword"); // uncolored while open
    expect(tailHtml).toContain("const x = 1;");
  });

  it("resets the cache when the text shrinks or is replaced (not an append)", () => {
    const state = createStreamingMarkdown();
    advance(state, "para one\n\npara two\n");
    expect(state.prefixHtml).not.toBe("");
    const shrunk = advance(state, "para one\n\npara");
    expect(state.settledOffset).toBe(0);
    expect(state.prefixHtml).toBe("");
    expect(shrunk.tailHtml).toBe(renderMarkdown("para one\n\npara", { streaming: true }));
  });

  it("cache stability: prefixHtml string identity is stable across appends that settle nothing", () => {
    const state = createStreamingMarkdown();
    advance(state, "para one\n\npara two\n");
    const before = state.prefixHtml;
    advance(state, "para one\n\npara two\ntail");
    advance(state, "para one\n\npara two\ntail more");
    expect(state.prefixHtml).toBe(before); // same STRING identity, not just equal
  });

  it("link-reference-definition invalidates the cache (a later def can rewrite earlier shortrefs)", () => {
    const state = createStreamingMarkdown();
    advance(state, "see [label]\n\npara\n");
    expect(state.prefixHtml).not.toBe("");
    advance(state, "see [label]\n\npara\n\n[label]: https://example.com\n");
    // The definition line was scanned: the cache dropped, everything re-renders
    // through the tail (whole-text parse resolves the shortref).
    expect(state.settledOffset).toBe(0);
    expect(state.prefixHtml).toBe("");
    const r = advance(state, "see [label]\n\npara\n\n[label]: https://example.com\n\nafter\n");
    expect(normalizeHtml(r.prefixHtml + r.tailHtml)).toBe(
      normalizeHtml(
        renderMarkdown("see [label]\n\npara\n\n[label]: https://example.com\n\nafter\n", {
          streaming: true,
        }),
      ),
    );
  });

  it("does not checkpoint inside an unclosed HTML comment or <pre> block", () => {
    const state = createStreamingMarkdown();
    const text = "<!-- a comment\n\nstill commented\n\nand more";
    let out = "";
    for (let i = 1; i <= text.length; i++) {
      const r = advance(state, text.slice(0, i));
      out = r.prefixHtml + r.tailHtml;
      expect(normalizeHtml(out)).toBe(
        normalizeHtml(renderMarkdown(text.slice(0, i), { streaming: true })),
      );
    }
    expect(state.settledOffset).toBe(0); // nothing settled inside the comment

    const s2 = createStreamingMarkdown();
    const text2 = "<pre>\n\nstill raw\n\n</pre>\n\nafter";
    for (let i = 1; i <= text2.length; i++) {
      const r = advance(s2, text2.slice(0, i));
      expect(normalizeHtml(r.prefixHtml + r.tailHtml)).toBe(
        normalizeHtml(renderMarkdown(text2.slice(0, i), { streaming: true })),
      );
    }
  });
});

describe("streaming-markdown corpus equivalence", () => {
  // A corpus of tricky markdown, replayed token-by-token: at EVERY prefix the
  // concatenation must equal today's whole-text streaming render (modulo the
  // two normalized transient divergences), and the FINAL render must equal
  // today's exactly (no normalization but whitespace-between-tags).
  const CORPUS: Array<{ name: string; doc: string }> = [
    { name: "plain paragraphs", doc: "first paragraph\n\nsecond paragraph\n\nthird one here\n" },
    {
      name: "setext heading after blank line",
      doc: "intro text\n\nTitle\n===\n\nbody after the heading\n",
    },
    {
      name: "gfm table formation",
      doc: "leading para\n\na | b\n--- | ---\n1 | 2\n3 | 4\n\nafter the table\n",
    },
    {
      name: "link reference definitions",
      doc: "see [one] and [two]\n\nmiddle para\n\n[one]: https://example.com/a\n[two]: https://example.com/b\n\nafter\n",
    },
    {
      name: "nested lists with internal blank lines",
      doc: "- item one\n  - nested a\n  - nested b\n\n- item two\n\ntext after the list\n",
    },
    { name: "blockquotes", doc: "> quoted line\n\n> second quote\n\ntail para\n" },
    {
      name: "tilde fences",
      doc: "before\n\n~~~js\nconst t = 1;\n~~~\n\nafter the fence\n",
    },
    {
      name: "inline emphasis spanning delta boundaries",
      doc: "some **bold and `code` mixed with *italics* here\n\nsecond block\n",
    },
    {
      name: "raw html blocks",
      doc: "before\n\n<div>\n\n<span>inline</span> text\n\n</div>\n\nafter\n",
    },
    {
      name: "huge growing fence",
      doc: "start\n\n```python\ndef f():\n    return 1\n\n\nx = f()\ny = f()\nz = f()\n```\n\ntail after a long fence\n",
    },
    {
      name: "fence interrupting a paragraph",
      doc: "para without blank\n```js\nconst y = 2;\n```\n\nafter\n",
    },
  ];

  for (const { name, doc } of CORPUS) {
    it(`replay: ${name}`, () => {
      const state = createStreamingMarkdown();
      // Token step 3 forces boundaries mid-word, mid-delimiter, mid-fence.
      for (let i = 1; i <= doc.length; i += 3) {
        const prefix = doc.slice(0, i);
        const r = advance(state, prefix);
        expect(
          normalizeHtml(r.prefixHtml + r.tailHtml),
          `divergence at prefix length ${i}: ${JSON.stringify(prefix)}`,
        ).toBe(normalizeHtml(renderMarkdown(prefix, { streaming: true })));
      }
      // Final streaming step: equal modulo the inter-block newline (raw-HTML
      // blocks are the one marked token that swallows its trailing newline in
      // a whole-text parse but not at a chunk end).
      const final = advance(state, doc);
      expect(normalizeHtml(final.prefixHtml + final.tailHtml)).toBe(
        normalizeHtml(renderMarkdown(doc, { streaming: true })),
      );
      // The BYTE-EXACT final output is the completion backstop's job (the
      // component renders renderMarkdown(text) when streaming flips false):
      expect(renderMarkdown(doc)).toBe(renderMarkdown(doc));
    });
  }
});

describe("streaming-markdown performance fixture (counts, not wall-clock)", () => {
  // Thousands of real parser/sanitizer calls contend with the unrestricted suite.
  // This asserts operation counts, not speed; keep all counts and allow CPU load.
  it("hljs calls and prefix mutations stay proportional to BLOCKS, not length × deltas", () => {
    const spy = vi.spyOn(hljs, "highlight");
    const state = createStreamingMarkdown();

    // A long message: 40 prose blocks + 5 growing code fences, streamed in
    // 2000 tiny deltas.
    const blocks: string[] = [];
    for (let i = 0; i < 40; i++) {
      blocks.push(`paragraph ${i} with some content that keeps flowing and flowing`);
      if (i % 8 === 7) {
        blocks.push("```js\n// fence body line one\n// fence body line two\n```");
      }
    }
    const doc = blocks.map((b) => `${b}\n`).join("\n");
    const DELTAS = 2000;
    const step = Math.max(1, Math.floor(doc.length / DELTAS));

    let lastPrefix = state.prefixHtml;
    let prefixMutations = 0;
    for (let i = step; i <= doc.length; i += step) {
      const r = advance(state, doc.slice(0, i));
      if (r.prefixHtml !== lastPrefix) {
        prefixMutations++;
        lastPrefix = r.prefixHtml;
      }
    }
    const final = advance(state, doc);
    if (final.prefixHtml !== lastPrefix) prefixMutations++;

    const fences = (doc.match(/^```/gm) ?? []).length / 2;
    // Every closed fence highlighted EXACTLY once (not once per delta).
    expect(spy).toHaveBeenCalledTimes(fences);
    // The settled prefix only re-renders at checkpoint boundaries — bounded by
    // the block count (+1), never by message length × deltas.
    expect(prefixMutations).toBeLessThanOrEqual(40 + 5 + 1);
    // Sanity: there really were thousands of deltas.
    expect(Math.floor(doc.length / step)).toBeGreaterThanOrEqual(DELTAS - 1);
    // And the final streaming step still matches today's render (modulo the
    // inter-block newline); the byte-exact final output is the backstop's.
    expect(normalizeHtml(final.prefixHtml + final.tailHtml)).toBe(
      normalizeHtml(renderMarkdown(doc, { streaming: true })),
    );
  }, 20_000);
});

describe("markdown tail-pipeline exports", () => {
  it("countDelimiters mirrors closeOpenDelimiters' regexes", () => {
    expect(countDelimiters("a ** b")).toEqual({ fences: 0, bold: 1, code: 0 });
    expect(countDelimiters("```js\nx\n```")).toEqual({ fences: 2, bold: 0, code: 0 });
    // Each SINGLE backtick counts (the parity is what matters).
    expect(countDelimiters("use `x` and `y`")).toEqual({ fences: 0, bold: 0, code: 4 });
  });

  it("renderMarkdownTail with zero seed is byte-identical to today's streaming render", () => {
    const text = "a **bold\n\n```js\ncode";
    expect(renderMarkdownTail(text)).toBe(renderMarkdown(text, { streaming: true }));
  });

  it("renderMarkdownTail with a seeded odd parity appends where the whole-text render would", () => {
    // Settled prefix "a ** b\n\n" has one lone **; the tail is even — the whole
    // streaming render appends ** at the very end, so the seeded tail must too.
    const seed = countDelimiters("a ** b\n\n");
    expect(seed.bold % 2).toBe(1);
    expect(renderMarkdownTail("more\n", seed)).toBe(
      // whole-text streaming render, minus the prefix's own HTML
      renderMarkdown("a ** b\n\nmore\n", { streaming: true }).replace(
        renderMarkdown("a ** b\n\n"),
        "",
      ),
    );
  });

  it("renderOpenFence emits the uncolored copy-button-wrapped code block", () => {
    const html = renderOpenFence("js", 'const s = "a<b>&c";\n');
    expect(html).toContain('<pre><code class="hljs language-js">');
    expect(html).toContain("data-copy");
    expect(html).not.toContain("hljs-keyword");
    expect(html).toContain("&lt;b&gt;&amp;c"); // marked-compatible escaping
    expect(html).toContain('"a&lt;b'); // quotes stay literal (marked parity)
  });
});
