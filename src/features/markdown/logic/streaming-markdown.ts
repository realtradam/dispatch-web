/**
 * Checkpoint streaming Markdown — pure logic for rendering a GROWING message
 * without re-running the full pipeline (marked → hljs → copy buttons →
 * DOMPurify) over the whole text on every delta.
 *
 * Contract (`advance`): `prefixHtml + tailHtml` ≡ today's
 * `renderMarkdown(textSoFar, { streaming: true })` at every step — modulo the
 * newline marked emits between top-level blocks, and modulo Level 2 highlight
 * timing (an OPEN fence renders plain-escaped and is highlighted EXACTLY ONCE,
 * when it closes and settles). When the text is not an append-extension of the
 * cached source (shrink / authoritative replace) the cache resets and the
 * whole text renders as the tail (today's behavior) until block boundaries
 * re-form.
 *
 * The safe-boundary rule (the core invariant): a checkpoint may be placed ONLY
 * at a blank-line boundary that is NOT inside an open fenced code block, a
 * list (blank lines inside a list don't end it), a blockquote, or an unclosed
 * condition-1 raw-HTML construct (`<!-- … -->`, `<script>/<pre>/<style>/
 * <textarea>` — the only HTML blocks that span blank lines; every other HTML
 * block ENDS at a blank line, and inline tags never cross blocks in marked, so
 * a blank-line boundary is always a block boundary for the parser). When
 * uncertain → do NOT checkpoint; extend the tail. The failure mode is degraded
 * caching, NEVER wrong output. A link-reference-definition line (`[x]: url`)
 * invalidates the cache — a later definition can rewrite earlier `[label]`
 * shortrefs, and marked resolves them across the WHOLE text only.
 *
 * Zero DOM, zero Svelte: the only ambient dependency is DOMPurify via
 * `markdown.ts` (sanitized everywhere, same as today).
 */

import {
  countDelimiters,
  type DelimiterCounts,
  type MarkdownImageOptions,
  type MarkdownRenderOptions,
  renderMarkdown,
  renderMarkdownTail,
  renderOpenFence,
} from "./markdown";

/** The split render for the current text: settled blocks + the live tail. */
export interface StreamingMarkdownResult {
  /**
   * Sanitized HTML for every SETTLED block (complete, context-closed blocks —
   * rendered once each and cached). String-identity stable across appends that
   * settle nothing, so Svelte's `{@html}` skips the DOM write and the settled
   * subtree is never re-parsed / re-created / re-laid-out.
   */
  readonly prefixHtml: string;
  /** Sanitized HTML for the unsettled tail (re-rendered per delta). */
  readonly tailHtml: string;
}

/**
 * The streaming-render state: created once per streaming message (per Markdown
 * component instance) and threaded through {@link advance}. Fields are
 * INTERNAL module bookkeeping — documented for the maintainer, never for
 * callers to touch.
 */
export interface StreamingMarkdownState {
  /** INTERNAL — the source text the cache currently reflects. */
  source: string;
  /** INTERNAL — source[0..settledOffset] is settled (rendered into prefixHtml). */
  settledOffset: number;
  /** INTERNAL — cached HTML for source[0..settledOffset]. */
  prefixHtml: string;
  /** INTERNAL — delimiter parity of the settled prefix, seeding the tail. */
  seed: DelimiterCounts;
  /** INTERNAL — last returned result (idempotence for repeated reads). */
  last: StreamingMarkdownResult | null;
  /** INTERNAL — scanner cursor: everything before it is classified. */
  scanOffset: number;
  /** INTERNAL — the open top-level fenced code block, if any. */
  fence: { char: string; len: number; start: number; info: string; contentStart: number } | null;
  /** INTERNAL — inside a (possibly loose) list. */
  inList: boolean;
  /** INTERNAL — inside a blockquote. */
  inQuote: boolean;
  /** INTERNAL — inside a multi-line `<!-- … -->` comment block. */
  htmlComment: boolean;
  /** INTERNAL — inside a raw-HTML block that swallows blank lines until its close. */
  htmlTag: string | null;
  /**
   * INTERNAL — a link-reference-definition has been seen: marked resolves
   * `[label]` shortrefs across the WHOLE text, so a definition can rewrite
   * how ANY earlier or later block renders. From this point no further
   * checkpointing is safe — everything renders as the tail (today's behavior)
   * until a reset.
   */
  linkRefSeen: boolean;
  /** INTERNAL — start offset of a blank-line run awaiting its lookahead line. */
  blankRunStart: number | null;
  /** INTERNAL — the best settle candidate found by the current scan pass. */
  pendingSettle: number;
  /**
   * INTERNAL — identity of the image-render options (apiBase + cwd) the cache
   * was rendered with. The options can arrive asynchronously (the cwd loads
   * after mount), so a change invalidates the settled cache: image srcs in the
   * prefix would otherwise keep the stale resolution.
   */
  imageKey: string;
}

/** Fresh state for one streaming message. */
export function createStreamingMarkdown(): StreamingMarkdownState {
  return {
    source: "",
    settledOffset: 0,
    prefixHtml: "",
    seed: { fences: 0, bold: 0, code: 0 },
    last: null,
    scanOffset: 0,
    fence: null,
    inList: false,
    inQuote: false,
    htmlComment: false,
    htmlTag: null,
    linkRefSeen: false,
    blankRunStart: null,
    pendingSettle: -1,
    imageKey: "",
  };
}

/** Identity of the image options, so an async cwd appearing invalidates the cache. */
function imageKeyOf(image: MarkdownImageOptions | undefined): string {
  return image === undefined ? "" : JSON.stringify([image.apiBase, image.cwd ?? null]);
}

/** Build per-render options without setting `image: undefined` (exactOptionalPropertyTypes). */
function renderOptionsOf(
  image: MarkdownImageOptions | undefined,
): MarkdownRenderOptions | undefined {
  return image === undefined ? undefined : { image };
}

// ── Scanner helpers (CommonMark block starts, mirroring what marked does) ──

/** A fenced-code-block opening line: ≤3 spaces indent, ≥3 backticks/tildes + info string. */
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
/** A blockquote marker. */
const QUOTE_OPEN = /^ {0,3}>/;
/** A list-item marker (bullet, or ≤9 digits + `.`/`)`) followed by space or EOL. */
const LIST_ITEM = /^ {0,3}([-*+]|\d{1,9}[.)])(\s|$)/;
/** A line indented into list-item content (tabs treated conservatively). */
const INDENTED = /^( {4,}|\t)/;
/** A blank line. */
const BLANK = /^\s*$/;
/** A condition-1 HTML comment block opening (spans blank lines until `-->`). */
const COMMENT_OPEN = /^ {0,3}<!--/;
/**
 * Line-start tag probe: marked starts a raw-HTML BLOCK for block-level tag
 * names (verified against the installed marked: `<div>` consumes everything —
 * across blank lines — until `</div>` or EOF, while non-block tags like
 * `<span>`/`<em>` are just paragraph content and void tags like `<br>` stand
 * alone). Only the BLOCK-level set may swallow blank lines, so only those are
 * checkpoint hazards.
 */
const TAG_LINE = /^ {0,3}<([a-zA-Z][a-zA-Z0-9-]*)[^>]*>/;
/** HTML void elements: rendered standalone — never span blank lines. */
const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "source",
  "track",
  "wbr",
]);
/** Block-level HTML tags that marked's raw-HTML block spans until its close. */
const BLOCK_TAGS = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "details",
  "dd",
  "div",
  "dl",
  "dt",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hgroup",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "ul",
]);
/**
 * A link-reference-definition line — NEVER checkpoint after seeing one: marked
 * resolves `[label]` shortrefs across the WHOLE text, so a definition can
 * rewrite how ALREADY-SETTLED blocks render.
 */
const LINK_REF_DEF = /^ {0,3}\[.*\]:/;

/** A valid CLOSING fence line: same char, ≥ the opening length, nothing else. */
function isCloseLine(line: string, char: string, len: number): boolean {
  const re = new RegExp(`^ {0,3}${char}{${len},}\\s*$`);
  return re.test(line);
}

function addCounts(a: DelimiterCounts, b: DelimiterCounts): DelimiterCounts {
  return { fences: a.fences + b.fences, bold: a.bold + b.bold, code: a.code + b.code };
}

/** Drop all cached work — the text is not an append-extension of the cache. */
function resetTo(s: StreamingMarkdownState, text: string): void {
  s.source = text;
  s.settledOffset = 0;
  s.prefixHtml = "";
  s.seed = { fences: 0, bold: 0, code: 0 };
  s.last = null;
  s.scanOffset = 0;
  s.fence = null;
  s.inList = false;
  s.inQuote = false;
  s.htmlComment = false;
  s.htmlTag = null;
  s.linkRefSeen = false;
  s.blankRunStart = null;
  s.pendingSettle = -1;
}

/**
 * Invalidate the settled cache in place (keep the scanner cursor — offsets are
 * still valid): everything renders as the tail from here until the next
 * settle, which re-renders source[0..end] as ONE parse.
 */
function invalidateCache(s: StreamingMarkdownState): void {
  s.settledOffset = 0;
  s.prefixHtml = "";
  s.seed = { fences: 0, bold: 0, code: 0 };
  s.pendingSettle = -1;
}

/**
 * Incrementally classify complete lines from `scanOffset`, maintaining the
 * block context and recording the best (last) safe settle candidate:
 *  - the end of a top-level fence's CLOSING line (the fence is final — it
 *    settles together with the prose before it, highlighted exactly once), and
 *  - the start of a blank-line run whose context is closed (fence closed, not
 *    inside a list/quote/raw-HTML) and whose lookahead line doesn't continue
 *    the construct (a `>` line continues a quote; an item/indented line
 *    continues a list).
 */
function scan(s: StreamingMarkdownState): void {
  const src = s.source;
  const len = src.length;
  let i = s.scanOffset;
  s.pendingSettle = -1;
  while (i < len) {
    const nl = src.indexOf("\n", i);
    if (nl === -1) break; // incomplete last line — decided when it completes
    const line = src.slice(i, nl);
    const lineEnd = nl + 1;

    // Once a link-reference-definition has been seen, no checkpoint is ever
    // safe again (shortrefs resolve across the whole text) — but the raw-HTML
    // / fence context tracking still matters for correctness of nothing else;
    // just consume lines.
    if (s.linkRefSeen) {
      i = lineEnd;
      continue;
    }

    // Condition-1 raw-HTML constructs span blank lines: nothing settles inside.
    if (s.htmlComment) {
      if (line.includes("-->")) s.htmlComment = false;
      s.blankRunStart = null;
      i = lineEnd;
      continue;
    }
    if (s.htmlTag !== null) {
      if (line.toLowerCase().includes(`</${s.htmlTag}`)) s.htmlTag = null;
      s.blankRunStart = null;
      i = lineEnd;
      continue;
    }

    // Inside a top-level fence: only the closing line matters. Blank lines and
    // ```-ish content inside the fence are never boundaries.
    if (s.fence !== null) {
      if (isCloseLine(line, s.fence.char, s.fence.len)) {
        s.fence = null;
        s.pendingSettle = lineEnd;
      }
      s.blankRunStart = null;
      i = lineEnd;
      continue;
    }

    // Blank line: start/extend a pending run; the next non-blank line decides.
    if (BLANK.test(line)) {
      if (s.blankRunStart === null) s.blankRunStart = i;
      i = lineEnd;
      continue;
    }

    // Non-blank line: resolve a pending blank run with THIS line as lookahead.
    if (s.blankRunStart !== null) {
      const runStart = s.blankRunStart;
      s.blankRunStart = null;
      if (s.inQuote) {
        if (!QUOTE_OPEN.test(line)) {
          s.pendingSettle = runStart; // the quote ended at the blank line
          s.inQuote = false;
        }
      } else if (s.inList) {
        if (!LIST_ITEM.test(line) && !INDENTED.test(line)) {
          s.pendingSettle = runStart; // the list ended at the blank line
          s.inList = false;
        }
      } else {
        s.pendingSettle = runStart;
      }
    }

    // Classify the non-blank line.
    if (!s.inList && !s.inQuote) {
      const fenceMatch = FENCE_OPEN.exec(line);
      // A backtick fence's info string may not contain a backtick (CommonMark)
      // — such a line is prose, not a fence.
      const marker = fenceMatch?.[1];
      const info = fenceMatch?.[2] ?? "";
      if (marker !== undefined && !(marker[0] === "`" && info.includes("`"))) {
        // Fenced code can interrupt a paragraph: the prose before this line is
        // final. The fence itself settles when its closing line arrives.
        s.pendingSettle = i;
        s.fence = {
          char: marker[0] === "`" ? "`" : "~",
          len: marker.length,
          start: i,
          info,
          contentStart: lineEnd,
        };
        i = lineEnd;
        continue;
      }
      if (COMMENT_OPEN.test(line)) {
        if (!line.includes("-->")) s.htmlComment = true;
        i = lineEnd;
        continue;
      }
      const tag = TAG_LINE.exec(line);
      if (tag !== null && tag[1] !== undefined) {
        const t = tag[1].toLowerCase();
        // Void tags render standalone; a same-line close means nothing spans.
        // Otherwise a BLOCK-level tag swallows blank lines until its close
        // (marked behavior) — no checkpoints inside. Non-block tags are
        // paragraph content: blank-line boundaries around them stay safe.
        const sameLineClosed = line.toLowerCase().includes(`</${t}`);
        if (!VOID_TAGS.has(t) && !sameLineClosed && BLOCK_TAGS.has(t)) {
          s.htmlTag = t;
        }
        i = lineEnd;
        continue;
      }
      if (LINK_REF_DEF.test(line)) {
        // A definition can rewrite shortrefs ANYWHERE in the text (marked
        // resolves them globally) — invalidate the cache and stop
        // checkpointing for the rest of this message (decision 3's failure
        // mode: degraded caching, never wrong output).
        s.linkRefSeen = true;
        invalidateCache(s);
        i = lineEnd;
        continue;
      }
    }
    if (QUOTE_OPEN.test(line)) {
      s.inQuote = true;
    } else if (LIST_ITEM.test(line)) {
      s.inList = true;
    }
    i = lineEnd;
  }
  s.scanOffset = i;
}

/** Render the newly-settled span once and fold it into the prefix cache. */
function commitSettle(
  s: StreamingMarkdownState,
  end: number,
  image: MarkdownImageOptions | undefined,
): void {
  const chunk = s.source.slice(s.settledOffset, end);
  s.prefixHtml += renderMarkdown(chunk, renderOptionsOf(image));
  s.seed = addCounts(s.seed, countDelimiters(chunk));
  s.settledOffset = end;
}

/**
 * Feed the full text accumulated so far; get the split render (settled prefix
 * + live tail). Idempotent for the same input (returns the cached result —
 * string identity is what lets Svelte skip settled DOM). Resets itself when
 * the text shrinks or is otherwise not an append-extension.
 */
export function advance(
  state: StreamingMarkdownState,
  textSoFar: string,
  opts?: MarkdownRenderOptions,
): StreamingMarkdownResult {
  const image = opts?.image;
  const imageKey = imageKeyOf(image);
  if (textSoFar === state.source && state.last !== null && state.imageKey === imageKey) {
    return state.last;
  }
  // A changed render option (e.g. the cwd loading after mount) invalidates the
  // settled cache — its image srcs were resolved with the old options.
  if (state.imageKey !== imageKey || !textSoFar.startsWith(state.source)) {
    resetTo(state, textSoFar);
  } else {
    state.source = textSoFar;
  }
  state.imageKey = imageKey;

  // A PARTIAL trailing line that starts a `[…]:` definition already changes
  // how the whole-text parse resolves shortrefs (marked parses the truncated
  // definition), so the optimistic invalidation cannot wait for the newline.
  // Overly eager (a `[` that turns out to be a link) is only degraded caching.
  if (
    !state.linkRefSeen &&
    state.scanOffset < state.source.length &&
    /^\s*\[/.test(state.source.slice(state.scanOffset))
  ) {
    state.linkRefSeen = true;
    invalidateCache(state);
  }

  scan(state);
  if (!state.linkRefSeen && state.pendingSettle > state.settledOffset) {
    commitSettle(state, state.pendingSettle, image);
  }

  const result = renderTail(state, image);
  state.last = result;
  return result;
}

/**
 * Decide the tail's shape and render it:
 *  1. an OPEN top-level fence → plain-escaped (Level 2: zero hljs while open);
 *  2. an incomplete last line that opens a fence marker → same Level-2 path
 *     (keeps "uncolored while open" monotonic — no one-frame highlight flicker
 *     between the marker's arrival and the line's completion);
 *  3. otherwise prose → today's pipeline, seeded with the settled parity.
 */
function renderTail(
  s: StreamingMarkdownState,
  image: MarkdownImageOptions | undefined,
): StreamingMarkdownResult {
  // 1. Open top-level fence: everything from its opening line is code content.
  if (s.fence !== null && s.fence.start >= s.settledOffset) {
    let code = s.source.slice(s.fence.contentStart);
    // A partial last line shaped like the closing fence is the pending closer —
    // exclude it from the content (it completes and settles next delta).
    if (s.scanOffset < s.source.length) {
      const partial = s.source.slice(s.scanOffset);
      if (isCloseLine(partial, s.fence.char, s.fence.len)) {
        code = s.source.slice(s.fence.contentStart, s.scanOffset);
      }
    }
    return { prefixHtml: s.prefixHtml, tailHtml: renderOpenFence(s.fence.info, code) };
  }

  // 2. Incomplete last line opening a fence marker (top level only). Today's
  //    whole-text render parses the PARTIAL info string (the fence runs to
  //    EOF), so pass it through for the same transient `language-` class.
  if (
    !s.inList &&
    !s.inQuote &&
    !s.htmlComment &&
    s.htmlTag === null &&
    s.scanOffset < s.source.length
  ) {
    const partial = s.source.slice(s.scanOffset);
    const m = FENCE_OPEN.exec(partial);
    const marker = m?.[1];
    const info = m?.[2] ?? "";
    if (marker !== undefined && !(marker[0] === "`" && info.includes("`"))) {
      const prose = s.source.slice(s.settledOffset, s.scanOffset);
      return {
        prefixHtml: s.prefixHtml,
        tailHtml:
          renderMarkdownTail(prose, s.seed, renderOptionsOf(image)) + renderOpenFence(info, ""),
      };
    }
  }

  // 3. Prose tail.
  return {
    prefixHtml: s.prefixHtml,
    tailHtml: renderMarkdownTail(s.source.slice(s.settledOffset), s.seed, renderOptionsOf(image)),
  };
}
