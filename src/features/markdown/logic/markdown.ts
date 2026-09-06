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

/** Render Markdown to sanitized HTML. Returns `""` if parsing ever throws. */
export function renderMarkdown(text: string, opts?: { streaming?: boolean }): string {
  const src = opts?.streaming === true ? closeOpenDelimiters(text) : text;
  try {
    const raw = md.parse(src) as string;
    return DOMPurify.sanitize(addCopyButtons(raw));
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
export function renderMarkdownTail(text: string, seed: DelimiterCounts = ZERO_COUNTS): string {
  const src = closeOpenDelimiters(text, seed);
  try {
    const raw = md.parse(src) as string;
    return DOMPurify.sanitize(addCopyButtons(raw));
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
    return DOMPurify.sanitize(addCopyButtons(html));
  } catch {
    return "";
  }
}
