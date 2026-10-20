/**
 * Pure Markdown → sanitized-HTML renderer for assistant messages.
 *
 * Mirrors old Dispatch's stack (marked + marked-highlight + highlight.js +
 * DOMPurify; GFM + line breaks; streaming delimiter-closing), but kept fully
 * SYNCHRONOUS and pure: `input → output`, no effects, no `$effect`. Languages
 * are a fixed "hot set" registered at module load (no lazy dynamic import), so a
 * single `renderMarkdown(text)` call is deterministic and unit-testable.
 *
 * The only ambient dependency is DOMPurify, which sanitizes against the DOM —
 * present in the browser and in the jsdom test env.
 */

import DOMPurify from "dompurify";
import type { LanguageFn } from "highlight.js";
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdownLang from "highlight.js/lib/languages/markdown";
import php from "highlight.js/lib/languages/php";
import plaintext from "highlight.js/lib/languages/plaintext";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import shell from "highlight.js/lib/languages/shell";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import { Marked } from "marked";
import { markedHighlight } from "marked-highlight";
import { resolveImageUrl } from "../../../core/chunks";

// Hot set: registered eagerly so common code blocks highlight on first paint.
const HOT_LANGUAGES: Record<string, LanguageFn> = {
  bash,
  c,
  cpp,
  csharp,
  css,
  go,
  java,
  javascript,
  json,
  markdown: markdownLang,
  php,
  plaintext,
  python,
  ruby,
  rust,
  shell,
  sql,
  typescript,
  xml,
  yaml,
};
for (const [name, lang] of Object.entries(HOT_LANGUAGES)) {
  hljs.registerLanguage(name, lang);
}

// Normalize common fence aliases to canonical highlight.js names.
const ALIASES: Record<string, string> = {
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  tsx: "typescript",
  py: "python",
  py3: "python",
  rb: "ruby",
  sh: "bash",
  zsh: "bash",
  yml: "yaml",
  "c++": "cpp",
  cxx: "cpp",
  "c#": "csharp",
  cs: "csharp",
  htm: "xml",
  html: "xml",
  svg: "xml",
  md: "markdown",
  mdx: "markdown",
  golang: "go",
  rs: "rust",
};

function normalizeLang(lang: string): string {
  const lower = lang.toLowerCase().trim();
  return ALIASES[lower] ?? lower;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const md = new Marked(
  markedHighlight({
    emptyLangClass: "hljs",
    langPrefix: "hljs language-",
    highlight(code: string, lang: string): string {
      if (!lang) return escapeHtml(code);
      const name = normalizeLang(lang);
      if (!hljs.getLanguage(name)) return escapeHtml(code);
      try {
        return hljs.highlight(code, { language: name, ignoreIllegals: true }).value;
      } catch {
        return escapeHtml(code);
      }
    },
  }),
  { gfm: true, breaks: true },
);

/**
 * While a message is still streaming, balance dangling fences / emphasis so the
 * partial text renders cleanly instead of flashing raw markers. `seed` carries
 * the delimiter counts of the ALREADY-SETTLED prefix (see
 * `logic/streaming-markdown`): the full-text streaming render appends markers
 * at the very END of the whole source, so a tail rendered alone must count the
 * prefix's parity to append in exactly the same place (or not) — otherwise a
 * settled paragraph with a lone `**` would transiently render differently.
 */
function closeOpenDelimiters(
  src: string,
  seed: DelimiterCounts = { fences: 0, bold: 0, code: 0 },
): string {
  let out = src;
  const fenceCount = (out.match(/^```/gm) ?? []).length + seed.fences;
  if (fenceCount % 2 !== 0) out += "\n```";
  const boldCount = (out.match(/\*\*/g) ?? []).length + seed.bold;
  if (boldCount % 2 !== 0) out += "**";
  const inlineCode = (out.match(/(?<!`)`(?!`)/g) ?? []).length + seed.code;
  if (inlineCode % 2 !== 0) out += "`";
  return out;
}

/**
 * Counts of the delimiter constructs {@link closeOpenDelimiters} balances,
 * using the SAME regexes — the streaming checkpoint module accumulates them
 * over settled blocks and seeds the tail's balance pass with the total, so the
 * tail's appended markers land exactly where a whole-text render would put
 * them. Pure: `input → output`.
 */
export interface DelimiterCounts {
  readonly fences: number;
  readonly bold: number;
  readonly code: number;
}

const ZERO_COUNTS: DelimiterCounts = { fences: 0, bold: 0, code: 0 };

export function countDelimiters(src: string): DelimiterCounts {
  return {
    fences: (src.match(/^```/gm) ?? []).length,
    bold: (src.match(/\*\*/g) ?? []).length,
    code: (src.match(/(?<!`)`(?!`)/g) ?? []).length,
  };
}

// Wrap each fenced code block (`<pre>…</pre>`) in a positioned container with a
// copy button. marked emits exactly one `<pre>`/`</pre>` pair per block and
// escapes `<`/`>` inside code, so these literal tags only ever delimit blocks.
// `data-copy` is the delegation hook the component listens for; DOMPurify keeps
// `<button>` + `data-*` by default. Inline `<code>` has no `<pre>`, so it's untouched.
const COPY_BUTTON =
  '<button type="button" data-copy aria-label="Copy code"' +
  ' class="copy-btn btn btn-xs absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100">Copy</button>';

function addCopyButtons(html: string): string {
  return html
    .replace(/<pre>/g, `<div class="code-block group relative">${COPY_BUTTON}<pre>`)
    .replace(/<\/pre>/g, "</pre></div>");
}

/**
 * A dedicated, render-local DOMPurify instance: hooks never affect another
 * consumer or retain a conversation's backend allowlist. The document base is
 * part of the sanitizer's existing DOM dependency; no location/state is cached.
 */
function sanitize(html: string, image?: MarkdownImageOptions): string {
  const purify = DOMPurify();
  const base = document.baseURI;
  const origin = new URL(base).origin;
  const backendOrigin = image === undefined ? origin : new URL(image.apiBase || base, base).origin;
  purify.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName === "A" && node.hasAttribute("href")) {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer");
    }
    if (node.tagName !== "IMG") return;
    const src = node.getAttribute("src");
    if (src === null) return;
    let url: URL;
    try {
      url = new URL(src, base);
    } catch {
      node.removeAttribute("src");
      return;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return;
    if (url.origin === origin || url.origin === backendOrigin) return;

    // Only safe, inert attributes are carried over. In particular, never copy
    // srcset or author event handlers to the image created after consent.
    const button = node.ownerDocument.createElement("button");
    button.setAttribute("type", "button");
    button.setAttribute("class", "remote-image btn btn-sm");
    button.setAttribute("data-src", url.href);
    button.setAttribute("data-alt", node.getAttribute("alt") ?? "");
    const title = node.getAttribute("title");
    if (title !== null) button.setAttribute("data-title", title);
    button.textContent = `Load image from ${url.host}`;
    node.parentNode?.replaceChild(button, node);
  });
  // Responsive candidates on <img>/<picture> must not bypass the src hook.
  return purify.sanitize(html, { FORBID_ATTR: ["srcset"] });
}

/**
 * Per-conversation context for rendering local-path images inline. `apiBase`
 * is the backend HTTP base (may be `""` → a root-relative `/local-image?…`);
 * `cwd` resolves RELATIVE Markdown image srcs against the conversation's
 * working directory (the same machine the backend serves files from).
 */
export interface MarkdownImageOptions {
  readonly apiBase: string;
  readonly cwd?: string | null;
}

/** Render options shared by all three render paths. */
export interface MarkdownRenderOptions {
  /** Balance dangling delimiters while the message is still generating. */
  readonly streaming?: boolean;
  /** Rewrite local-path image srcs through the backend's `/local-image` route. */
  readonly image?: MarkdownImageOptions;
}

/** Decode a URL-ish path, tolerating malformed `%` escapes. */
function safeDecode(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

/**
 * Rewrite one image `src` for the local-image feature. Pure: `input → output`.
 *
 * - `file:///path` → local absolute path (scheme stripped).
 * - `/absolute/path` → local absolute path.
 * - a relative path (no scheme, no leading `/`) → joined to the conversation
 *   `cwd` (no `cwd` → left untouched).
 * - `http(s)://…`, `data:`, and any other scheme → left untouched.
 *
 * Local paths become `${apiBase}/local-image?path=<encoded>`, reusing
 * `resolveImageUrl`'s join-without-double-slash semantics (an empty `apiBase`
 * yields a root-relative path).
 */
function rewriteImageSrc(src: string, image: MarkdownImageOptions): string {
  const trimmed = src.trim();
  if (trimmed.length === 0) return src;
  // Network-path URLs (including browser-normalized backslashes) are URLs,
  // not local filesystem paths. The sanitizer applies the consent policy.
  if (/^(?:data:|https?:\/\/)/i.test(trimmed) || /^[/\\]{2}/.test(trimmed)) return src;

  let path: string;

  if (/^file:\/\//i.test(trimmed)) {
    // file:///abs/path (and file://localhost/abs/path) → /abs/path.
    const match = /^file:\/\/([^/]*)(\/.*)?$/i.exec(trimmed);
    if (match === null) return src;
    const host = match[1] ?? "";
    const filePath = match[2] ?? "/";
    path = host === "" || host.toLowerCase() === "localhost" ? filePath : `/${host}${filePath}`;
    path = safeDecode(path);
  } else if (trimmed.startsWith("/")) {
    path = safeDecode(trimmed);
  } else if (trimmed.startsWith("~/")) {
    // The backend expands a leading `~`; pass it through un-joined.
    path = trimmed;
  } else if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
    // Some other scheme (mailto:, ftp:, …) — leave it alone.
    return src;
  } else {
    const cwd = image.cwd ?? null;
    if (cwd === null || cwd.length === 0) return src;
    const base = cwd.replace(/\/+$/, "");
    path = `${base}/${safeDecode(trimmed.replace(/^\.\//, ""))}`;
  }

  return resolveImageUrl(`/local-image?path=${encodeURIComponent(path)}`, image.apiBase);
}

/**
 * Parse with marked, optionally rewriting image token `href`s just before
 * rendering. Doing it on the token stream (not the Markdown source) means
 * fenced/inline code is never touched, and reference-style images resolve
 * through marked's normal link resolution. When `image` is absent the parse is
 * byte-identical to today's.
 */
function parseMarkdown(src: string, image?: MarkdownImageOptions): string {
  if (image === undefined) return md.parse(src) as string;

  const renderer = new md.Renderer();
  const imageRenderer = renderer.image;
  renderer.image = (token) =>
    imageRenderer.call(renderer, {
      ...token,
      href: rewriteImageSrc(token.href, image),
    });
  return md.parse(src, { renderer }) as string;
}

/** Render Markdown to sanitized HTML. Returns `""` if parsing ever throws. */
export function renderMarkdown(text: string, opts?: MarkdownRenderOptions): string {
  const src = opts?.streaming === true ? closeOpenDelimiters(text) : text;
  try {
    return sanitize(addCopyButtons(parseMarkdown(src, opts?.image)), opts?.image);
  } catch {
    return "";
  }
}

/**
 * The streaming TAIL pipeline — today's exact pipeline for the UNSETTLED tail
 * of a streaming message (`closeOpenDelimiters` → marked → copy buttons →
 * DOMPurify), with the delimiter parity SEEDED from the settled prefix (see
 * {@link countDelimiters}). With a zero seed this is byte-identical to
 * `renderMarkdown(text, { streaming: true })`, so the checkpoint module's
 * degenerate case (nothing settled yet) is exactly today's behavior.
 * Returns `""` if parsing ever throws.
 */
export function renderMarkdownTail(
  text: string,
  seed: DelimiterCounts = ZERO_COUNTS,
  opts?: MarkdownRenderOptions,
): string {
  const src = closeOpenDelimiters(text, seed);
  try {
    return sanitize(addCopyButtons(parseMarkdown(src, opts?.image)), opts?.image);
  } catch {
    return "";
  }
}

/**
 * Escapes code content the way marked does inside `<code>` (only `&`, `<`,
 * `>` — quotes stay literal) so the plain open-fence render below is
 * character-identical to what the closed-fence pipeline would emit.
 */
function escapeCode(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Plain (UN-highlighted) rendering of an OPEN fenced code block — the Level-2
 * streaming behavior: while a fence is still open its content is final-format
 * escaped `<pre><code>` with NO hljs (hljs state spans lines — an unterminated
 * string/block comment would recolor earlier lines, so line-incremental
 * highlighting is unsound). The block is highlighted exactly ONCE, when it
 * closes and settles into the checkpoint cache. Emits the same copy-button
 * wrapper + `hljs language-X` classes as the closed pipeline (modulo color
 * spans), so the pop-in on close is "just colour".
 */
export function renderOpenFence(info: string, code: string): string {
  const lang = info.trim().split(/\s+/)[0] ?? "";
  const cls = lang === "" ? "hljs" : `hljs language-${escapeHtml(lang)}`;
  const html = `<pre><code class="${cls}">${escapeCode(code)}</code></pre>`;
  try {
    return sanitize(addCopyButtons(html));
  } catch {
    return "";
  }
}
