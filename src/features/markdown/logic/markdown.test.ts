import { describe, expect, it } from "vitest";
import { renderMarkdown, renderMarkdownTail } from "./markdown";
import { advance, createStreamingMarkdown } from "./streaming-markdown";

/** The single rendered `<img>` src, or null. */
function imageSrc(html: string): string | null {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return doc.querySelector("img")?.getAttribute("src") ?? null;
}

describe("renderMarkdown", () => {
  it("renders GFM markdown (headings, emphasis)", () => {
    const html = renderMarkdown("# Title\n\nSome **bold** text.");
    expect(html).toContain("<h1");
    expect(html).toContain("Title");
    expect(html).toContain("<strong>bold</strong>");
  });

  it("highlights fenced code for a known language", () => {
    const html = renderMarkdown("```javascript\nconst x = 1;\n```");
    expect(html).toContain("language-javascript");
    expect(html).toContain("hljs-keyword"); // `const` got highlighted
  });

  it("resolves language aliases (js -> javascript)", () => {
    const html = renderMarkdown("```js\nconst x = 1;\n```");
    expect(html).toContain("hljs-keyword");
  });

  it("escapes code for an unknown language without throwing", () => {
    const html = renderMarkdown("```nope\n<b>x</b>\n```");
    expect(html).toContain("&lt;b&gt;");
  });

  describe("links open in a new tab", () => {
    function anchors(html: string): HTMLAnchorElement[] {
      const doc = new DOMParser().parseFromString(html, "text/html");
      return Array.from(doc.querySelectorAll("a"));
    }

    it.each([
      ["a markdown link", "See [the docs](https://example.com/docs)."],
      ["a GFM autolink", "Visit https://example.com today"],
      ["an angle-bracket autolink", "<https://example.com>"],
      ["a raw-HTML anchor", 'Raw <a href="https://example.com">link</a>'],
      ["a relative link", "[home](/settings)"],
    ])("%s gets target=_blank + rel=noopener noreferrer", (_label, src) => {
      const links = anchors(renderMarkdown(src));
      expect(links).toHaveLength(1);
      expect(links[0]?.getAttribute("target")).toBe("_blank");
      expect(links[0]?.getAttribute("rel")).toBe("noopener noreferrer");
    });

    it("overrides an author-supplied target/rel", () => {
      const [link] = anchors(
        renderMarkdown('<a href="https://example.com" target="_self" rel="opener">x</a>'),
      );
      expect(link?.getAttribute("target")).toBe("_blank");
      expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
    });

    it("applies while streaming too", () => {
      const [link] = anchors(
        renderMarkdown("partial [link](https://example.com) **bo", { streaming: true }),
      );
      expect(link?.getAttribute("target")).toBe("_blank");
    });

    it("still strips javascript: hrefs", () => {
      const html = renderMarkdown('<a href="javascript:alert(1)">x</a>');
      expect(html).not.toContain("javascript:");
    });
  });

  it("sanitizes dangerous HTML", () => {
    const html = renderMarkdown("Hi <script>alert(1)</script> there");
    expect(html).not.toContain("<script>");
    expect(html).toContain("Hi");
  });

  it("balances dangling bold emphasis while streaming", () => {
    expect(renderMarkdown("a **bold", { streaming: true })).toContain("<strong>bold</strong>");
  });

  it("does not balance delimiters when not streaming", () => {
    expect(renderMarkdown("a **bold")).not.toContain("<strong>");
  });

  it("wraps fenced code blocks with a copy button", () => {
    const html = renderMarkdown("```js\nconst x = 1;\n```");
    expect(html).toContain("code-block");
    expect(html).toContain("data-copy");
    expect(html).toContain("<pre>");
  });

  it("does not add a copy button to inline code", () => {
    const html = renderMarkdown("use `npm run dev` please");
    expect(html).not.toContain("data-copy");
    expect(html).toContain("<code>npm run dev</code>");
  });

  it("returns an empty string for empty input", () => {
    expect(renderMarkdown("")).toBe("");
  });

  describe("local-path images", () => {
    const BASE = "http://localhost:24203";
    const image = { apiBase: BASE, cwd: "/w/foo" };

    it("rewrites a file:// URL to the backend image route", () => {
      expect(imageSrc(renderMarkdown("![pic](file:///home/u/pic.png)", { image }))).toBe(
        `${BASE}/local-image?path=%2Fhome%2Fu%2Fpic.png`,
      );
    });

    it("rewrites an absolute path; an empty apiBase yields a root-relative src", () => {
      expect(imageSrc(renderMarkdown("![pic](/home/u/pic.png)", { image: { apiBase: "" } }))).toBe(
        "/local-image?path=%2Fhome%2Fu%2Fpic.png",
      );
      expect(imageSrc(renderMarkdown("![pic](/home/u/pic.png)", { image }))).toBe(
        `${BASE}/local-image?path=%2Fhome%2Fu%2Fpic.png`,
      );
    });

    it("resolves a relative path against the conversation cwd", () => {
      expect(imageSrc(renderMarkdown("![shot](shot.png)", { image }))).toBe(
        `${BASE}/local-image?path=%2Fw%2Ffoo%2Fshot.png`,
      );
      expect(
        imageSrc(renderMarkdown("![shot](shot.png)", { image: { apiBase: BASE, cwd: "/w/foo/" } })),
      ).toBe(`${BASE}/local-image?path=%2Fw%2Ffoo%2Fshot.png`);
    });

    it("leaves a relative path untouched when no cwd is available", () => {
      expect(imageSrc(renderMarkdown("![shot](shot.png)", { image: { apiBase: BASE } }))).toBe(
        "shot.png",
      );
      expect(imageSrc(renderMarkdown("![shot](shot.png)", { image }))).toBe(
        `${BASE}/local-image?path=%2Fw%2Ffoo%2Fshot.png`,
      );
      expect(imageSrc(renderMarkdown("![shot](shot.png)"))).toBe("shot.png");
    });

    it("leaves remote http(s) and data: images untouched", () => {
      expect(imageSrc(renderMarkdown("![remote](https://example.com/a.png)", { image }))).toBe(
        "https://example.com/a.png",
      );
      expect(imageSrc(renderMarkdown("![remote](http://example.com/a.png)", { image }))).toBe(
        "http://example.com/a.png",
      );
      const data = "data:image/png;base64,iVBORw0KGgo=";
      expect(imageSrc(renderMarkdown(`![inline](${data})`, { image }))).toBe(data);
    });

    it("does not rewrite image syntax inside fenced code", () => {
      const html = renderMarkdown("```md\n![pic](/home/u/pic.png)\n```", { image });
      expect(html).toContain("/home/u/pic.png");
      expect(html).not.toContain("/local-image");
    });

    it("rewrites the streaming tail, the settled prefix, and a seeded tail", () => {
      const state = createStreamingMarkdown();
      const tail = advance(state, "![pic](/home/u/pic.png)", { image });
      expect(imageSrc(tail.tailHtml)).toBe(`${BASE}/local-image?path=%2Fhome%2Fu%2Fpic.png`);

      // The settled prefix must render with the same options too.
      const settled = advance(state, "![pic](/home/u/pic.png)\n\nnext\n", { image });
      expect(imageSrc(settled.prefixHtml)).toBe(`${BASE}/local-image?path=%2Fhome%2Fu%2Fpic.png`);

      const seeded = renderMarkdownTail(
        "![shot](shot.png)",
        { fences: 0, bold: 0, code: 0 },
        {
          image,
        },
      );
      expect(imageSrc(seeded)).toBe(`${BASE}/local-image?path=%2Fw%2Ffoo%2Fshot.png`);
    });

    it("invalidates the streaming cache when the image options change (async cwd)", () => {
      const state = createStreamingMarkdown();
      const text = "![shot](shot.png)\n\nnext\n";
      advance(state, text);
      expect(imageSrc(state.prefixHtml)).toBe("shot.png"); // no cwd yet
      const updated = advance(state, text, { image });
      expect(imageSrc(updated.prefixHtml)).toBe(`${BASE}/local-image?path=%2Fw%2Ffoo%2Fshot.png`);
    });
  });
});
