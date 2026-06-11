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
 * partial text renders cleanly instead of flashing raw markers.
 */
function closeOpenDelimiters(src: string): string {
	let out = src;
	const fenceCount = (out.match(/^```/gm) ?? []).length;
	if (fenceCount % 2 !== 0) out += "\n```";
	const boldCount = (out.match(/\*\*/g) ?? []).length;
	if (boldCount % 2 !== 0) out += "**";
	const inlineCode = (out.match(/(?<!`)`(?!`)/g) ?? []).length;
	if (inlineCode % 2 !== 0) out += "`";
	return out;
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
