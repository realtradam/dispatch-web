# Markdown Streaming Performance & UX — Implementation Plan

**Status:** Ready for implementation — RE-SCOPED (see Scope)
**Branch:** `feature/markdown-streaming-render` (renamed from `feature/instant-stop-frontend-render`; commit to HEAD)
**Spec:** `notes/instant-stop-2-spec-ref.md` (read-only reference copy in this worktree; original at `backend/notes/instant-stop-2-frontend-render-backlog.md`)

## Scope (IMPORTANT — this plan was re-scoped after the original dispatch)

This feature implements ONLY the **markdown rendering performance/UX fix** — the checkpoint caching design below. The spec's other items are explicitly DEFERRED and must NOT be implemented here:

- NO stop barrier / composer `stopping` state / stop-failure reconciliation (spec items A, B, C, G)
- NO delta coalescing / scroll frame-bounding (spec items D, F)
- No chat-store, Composer, ChatView, app-store, ws-adapter, or smart-scroll changes.

The markdown fix stands alone: `streaming-markdown.ts` + `Markdown.svelte` + `markdown.ts`, plus tests.

## Problem

Every streamed delta re-renders the ENTIRE accumulating message through the full pipeline (closeOpenDelimiters regexes over the whole text → marked parse → hljs highlight of every fenced block → copy-button rewrite → DOMPurify sanitize → `{@html}` full subtree replacement). Cost per token grows with message length — ~O(n²) over the message lifetime — so long responses and growing code fences jank the UI, and whole-subtree DOM replacement churns layout and scroll.

## Design — checkpoint caching of settled markdown blocks

### New pure module: `src/features/markdown/logic/streaming-markdown.ts`
- `createStreamingMarkdown()`; `advance(state, textSoFar) → { prefixHtml, tailHtml }`; reset when the text shrinks or is not an append-extension of the cached source (e.g. authoritative replace).
- Internals: a block-boundary line-scanner, a per-block HTML cache, and a settled-source offset.

### Safe-boundary rule (the core invariant)
A checkpoint may be placed ONLY at a blank-line boundary that is NOT inside:
- an open fenced code block (``` or ~~~),
- a list (any depth — blank lines inside a list do not end it),
- a blockquote,
- an unclosed raw-HTML construct (`<!-- -->`, unbalanced tag).

When uncertain → do NOT checkpoint; extend the tail. The failure mode is degraded caching, NEVER wrong output.

- Fallback: if new content matches a link-reference-definition pattern (`^\[.*\]:`), invalidate the cache and do one full re-render (a definition can rewrite earlier `[label]` shortrefs; rare in assistant output).
- Why blank-line + closed-context suffices: setext headings (`foo` + `---`) and GFM table delimiter rows require the triggering line to IMMEDIATELY follow the paragraph line — a blank line between makes retroactive block formation impossible. Lists/blockquotes/fences are tracked as open context by the scanner.

### Rendering levels
- **Level 1 (mandatory):** the tail renders through TODAY'S exact pipeline (`closeOpenDelimiters` on the tail only → marked → `addCopyButtons` → DOMPurify). Output contract: `prefixHtml + tailHtml` ≡ `renderMarkdown(textSoFar)` at every step, modulo the newline marked emits between top-level blocks.
- **Level 2 (approved by the user):** hljs is SKIPPED for the open tail fence (plain escaped `<pre><code>`); a code block is highlighted EXACTLY ONCE, when it closes (settled into the cache with its highlighted HTML). Code renders uncolored while its fence is open; colors pop in when the fence closes — accepted UX. NO line-incremental highlighting — unsound (hljs state spans lines; an unterminated string/block comment recolors earlier lines).
- **Completion backstop:** when `streaming` flips false (done / turn-sealed), do ONE full authoritative render via today's `renderMarkdown(text)` and use that. Final/persisted output is always byte-identical to today's behavior; any incremental-path divergence is transient (streaming-only) by construction.

### Component changes: `Markdown.svelte`
- Two sibling containers inside the existing `.markdown-body` wrapper: `<div>{@html prefixHtml}</div><div>{@html tailHtml}</div>`.
  VERIFIED in the installed runtime: Svelte 5 skips the DOM write when the html string is unchanged (`svelte/src/internal/client/dom/blocks/html.js:75` — `if (value === (value = get_value() ?? '')) return;`), so the settled prefix's DOM subtree is never re-parsed / re-created / re-laid-out.
- The wrappers must not break block margin collapsing: no padding/border/min-height on them.
- The delegated copy-button listener stays on the outer container (unchanged).
- `streaming === false` → the single-container full-render path (today's behavior, unchanged).
- Thinking chunks (plain pre-wrap) and user text chunks (plain `<p>`) are unaffected.

## Tests
- **Corpus equivalence property test:** a corpus of tricky markdown (setext after blank line; GFM table formation; link-reference definitions; nested lists with internal blank lines; blockquotes; ~~~ fences; inline emphasis spanning delta boundaries; raw HTML; a huge growing fence) replayed token-by-token: at EVERY prefix length, the concatenation (whitespace-normalized) equals `renderMarkdown(prefix)` where the boundary rule held, and the final render equals today's output exactly.
- hljs spy: exactly one highlight call per closed block; zero while a fence is open.
- Cache stability: `prefixHtml` string identity stable across appends; shrink/replace resets.
- All existing markdown tests remain green; sanitization guarantees unchanged for final HTML.

## Performance validation

Instrumented fixture (counts, not wall-clock): while streaming thousands of deltas into a long message with growing code fences, full-pipeline invocations and hljs calls remain proportional to the number of BLOCKS, not to message length × deltas. The subsystem is isolated — no full-app fixture needed.

## Files
- New: `src/features/markdown/logic/streaming-markdown.ts` (+ test).
- Modified: `src/features/markdown/ui/Markdown.svelte`; `src/features/markdown/logic/markdown.ts` only if the tail pipeline needs a shared export (+ tests).
- NOT modified: chat store, Composer, ChatView, app store, ws adapter, smart-scroll, backend.
  Note: the checkpoint fix itself removes most scroll/layout amplification, because settled content stops resizing (the ResizeObserver stops firing for the prefix) — no scroll-controller changes are needed for this feature.

## Verification gates

```
bun run typecheck && bun run test && bun run check && bun run build
```

## Commit plan

1. `docs(markdown): re-scoped implementation plan — streaming performance` (this file, replacing the earlier three-phase version)
2. `feat(markdown): checkpoint streaming render — settled-block cache, highlight on close`
(plus fixups as needed)

## Out of scope (deferred, separate future work)

- Stop barrier / stopping composer state / stop-failure reconciliation (spec items A, B, C, G).
- Delta coalescing + scroll frame-bounding (spec items D, F).
- Problem 1 (merged) / Problem 3 (backend queue semantics).
- Transcript virtualization; line-incremental highlighting (unsound).
- Backend WS event coalescing.
