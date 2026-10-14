# Tool-call display cleanup — plan

Branch: `feature/tool-call-display` (frontend-only; no backend change required).

## Goal (from the user)
1. A tool call and its response render as **one dropdown** — not a call card plus a separate
   result card.
2. The collapsed header shows a **concise summary of what was called AND what came back**
   (e.g. `run_shell  bun run test  →  128 lines`).
3. Inspiration: oh-my-pi's tool cards.

---

## 1. Current state (research)

### Data
- Wire (`.dispatch/wire.reference.md`): `ToolCallChunk { toolCallId, toolName, input: unknown, stepId? }`
  and `ToolResultChunk { toolCallId, toolName, content: string, isError, stepId? }`. Results are
  separate chunks (role `tool`), paired to calls by `toolCallId`. The kernel guarantees exactly one
  result per call (synthesized on interrupt).
- Results are **plain strings** — no structured `details` (exit code, line counts, diff, …). Any
  result summary must be derived from `content` + `isError` + the call's `input`.

### Rendering (`src/features/chat/ui/ChatView.svelte`, `src/core/chunks/groups.ts`)
- `groupRenderedChunks` makes a `tool-batch` group **only when a step has ≥2 calls**. Those batch
  entries already pair call+result in one `LazyCollapse` (title = wrench + toolName + spinner/error
  badge; body = `JSON.stringify(input)` then raw `content`).
- **Single-call steps (the common case) are NOT paired**: the call and the result each become a
  `single` group and render as two separate collapses with the same title (wrench + toolName). This
  is the "two dropdowns" the user sees.
- Neither path shows *what* was called or *what* came back in the collapsed header — only the tool
  name.
- Keys: single tool chunks are keyed `c<seq>` / `p<index>`, so a provisional single tool card
  changes key at seal → its open state is lost (same bug class the thinking-ordinal keys fixed).
- `LazyCollapse.svelte` (daisyUI checkbox collapse, lazily-mounted body) is the shared primitive —
  keep it.
- Consumers of `RenderGroup` beyond ChatView: `src/core/metrics/place.ts` (`groupStepId`,
  `groupTurnId` — step/turn metrics placement) and tests (`groups.test.ts`, `ui.test.ts`,
  `ChatView.test.ts`, `place.test.ts`, `placement-scenarios.test.ts`).
- Chat-limit trimming (`trim.ts`) unloads by chunk seq, so a call can be unloaded while its result
  stays loaded → an **orphan result** is possible and must still render.

### Dispatch tool result shapes (backend, read-only)
| tool | input | result `content` |
|---|---|---|
| `run_shell` | `command`, `timeout?` | raw output; `isError` on non-zero exit / abort; `…\n\n[Command timed out]`; `[Output truncated: …]` |
| `read_file` | `path`, `offset?`, `limit?` | numbered lines / dir listing / `(empty file: …)` |
| `edit_file` | `path`, `oldString`, `newString`, `replaceAll?` | `Replaced N occurrence(s) in "…".` (+ appended LSP diagnostics) |
| `write_file` | `path`, `content`, `overwrite?` | `Created/Overwrote "…" (N bytes).` |
| `web_search` | `query` / `url`, `mode?` | markdown text |
| `lsp` | `operation`, `path`, `line?`, `character?` | text |
| `todo_write` | `todos[]` | text |
| `load_skill` | `name` | skill text |
| `consult_vision` | `question`, `imageIds?`/`path?` | conv id + answer |
| agent tools (`summon_agent`, `send_agent_message`, `read_agent`, `list_agents`, …) | `task`/`agent`/`title`, `conversationId`, `message` | text |
| MCP tools | arbitrary | arbitrary → generic fallback |

Note: the exit code of `run_shell` is not in the result — only `isError`.

### oh-my-pi (`../../oh-my-pi/packages/collab-web/src/tool-render/`)
- **One card per call, result folded in** (`ToolView.tsx`): the transcript pairs `toolResult`
  messages to calls by id and passes `result` into the call's card; standalone results are never
  rendered.
- **Header (one line, always visible)**: status glyph (spinner running / green ok / red err /
  hollow pending) · tool name · per-tool **`Summary`** (truncated with ellipsis) · chevron.
- **Body (on expand)**: per-tool **`Body`** — args shown in a tool-appropriate way (e.g. `$ cmd`
  prompt line for bash, path for read, colored diff for edit) then output in an `Output` block that
  shows the first ~10–14 lines with a `⋯ N more lines` expander. Errors tinted red.
- **Registry** (`registry.ts`): `toolName → { Summary, Body }` with a **generic fallback**
  (`argsDigest` = compact one-line JSON of args; body = args JSON + result text).
- Summaries mostly describe the *call* (command / path / pattern / query) and append result facts as
  small badges when known (`+12 −3`, `failed`, `N matches`).

---

## 2. Design

### 2.1 One card per tool call (call + result)
Every tool call renders as exactly one collapse containing both call and response. A tool result is
never rendered on its own, except as an orphan (its call is unloaded) — then it renders as the same
card with the call side unknown.

Batches (≥2 calls in one step) keep their visual grouping (one bubble, stacked cards) but each entry
is the **same** tool card component as a single call. A single call is simply a 1-entry tool group —
one code path.

### 2.2 Collapsed header = call summary → result summary
```
[status] tool_name   <call summary, truncated…>   → <result summary>   [chevron]
```
- **status**: spinner while the result is pending; ✓ (success tint) on ok; ✗ (error tint) on
  `isError`. Replaces the generic wrench (or keep the wrench as the name's icon — visual nit, see
  open questions).
- **call summary**: the most meaningful argument, single-line, whitespace-collapsed, truncated
  (CSS `truncate` + a char cap).
- **result summary**: a short fact about the response (`128 lines`, `no output`, `1 replacement`,
  `3.2 KB`, `failed`, `timed out`, first line of an error…). Omitted while pending.

Examples:
```
✓ run_shell   bun run test                       → 42 lines
✗ run_shell   bun run typecheck                  → failed · 12 lines
✓ read_file   src/core/chunks/groups.ts:1-80     → 80 lines
✓ edit_file   src/features/chat/ui/ChatView.svelte  +3 −1 → 1 replacement
✓ write_file  notes/plan.md                      → created · 4.1 KB
✓ web_search  "svelte 5 runes snippets"          → 37 lines
✓ lsp         references src/app/store.svelte.ts:12 → 9 lines
⟳ summon_agent  "tool-call-display: research"    (running)
✓ mcp__foo    {"a":1,"b":"x"}                    → first line of output…
```

### 2.3 Expanded body
1. **Call**: a tool-appropriate view of the input — `$ <command>` for shell, path line for
   file tools, old/new for edit (as a simple −/+ block), otherwise a key/value list of scalar args with
   pretty JSON for nested values (fallback = current `JSON.stringify(input, null, 2)`).
2. **Response**: the `content` in a `<pre>`, error-tinted when `isError`; first ~12 lines shown
   with a `⋯ N more lines` toggle (avoids today's big `max-h-96` scroll boxes for long outputs;
   still lazily mounted by `LazyCollapse`).
3. Pending → "running…" placeholder instead of the response.

### 2.4 Where the per-tool knowledge lives
A pure, data-driven **summarizer table** keyed by `toolName` with a **generic fallback**, mirroring
oh-my-pi's registry. It only produces strings/view-models (no components), so ChatView stays one
generic template. Unknown/MCP tools → fallback:
- call summary: first present of `command | path | file_path | query | url | pattern | name |
  question | title | task | message | conversationId`, else compact one-line JSON of the input;
- result summary: `isError` ? `failed · <first line>` : `N lines` / `no output` / first line if
  single-line and short.

This is chat transcript rendering, not the surface interpreter, so the "never switch on a surface
id" rule doesn't apply; the table is optional per-tool polish with a guaranteed generic path
(GLOSSARY currently says tools are "rendered generically … by toolName" — this stays true for any
tool without an entry).

---

## 3. Implementation steps (dependency-ordered)

### Step 1 — Grouping: pair every call with its result (`src/core/chunks/groups.ts`)
- Replace the `single`-tool path + `tool-batch` (≥2) with one tool group kind for **all** tool calls:
  ```ts
  export interface ToolEntry {
    readonly toolCallId: string;
    readonly toolName: string;          // from call, or from the orphan result
    readonly call: ToolCallChunk | null; // null = orphan result (call unloaded by chat limit)
    readonly result: ToolResultChunk | null; // null = pending
  }
  | { kind: "tool-batch"; key: string; stepId?: string; entries: readonly ToolEntry[];
      provisional: boolean; turnId?: string }
  ```
  (Name check vs GLOSSARY before coining — keep `tool-batch` / `ToolBatchEntry` if possible to avoid
  vocab churn; `entries.length === 1` is a single call.)
- Group key: calls with a `stepId` group by step; calls without a `stepId` (legacy rows) form their
  own 1-entry group. Results are always absorbed into their call's entry (match by `toolCallId`).
- Orphan results (no call in the rendered window) → a 1-entry group at the result's position with
  `call: null`.
- Keep the existing duplicate-`toolCallId` dedupe.
- Stable render key: `b<stepId>` when present, else `t<toolCallId>` — survives the
  provisional→committed seal (fixes the lost-open-state bug for single tool cards).
- Update `src/core/metrics/place.ts` `groupStepId` / `groupTurnId` for the new shape (stepId now
  optional on the group).
- Tests: rewrite `groups.test.ts` cases (single call now grouped + paired; legacy no-stepId pairing;
  orphan result; pending result; dedupe), re-run `place.test.ts` / `placement-scenarios.test.ts`.

### Step 2 — Pure summary view-model (new `src/features/chat/logic/tool-summary.ts`)
```ts
export interface ToolCardView {
  readonly name: string;
  readonly status: "pending" | "ok" | "error";
  readonly callSummary: string;          // one line, truncated
  readonly callBadges: readonly string[]; // e.g. "+3 −1", ":1-80"
  readonly resultSummary: string | null; // null while pending
  readonly callDetail:                  // how to render the input when expanded
    | { kind: "command"; text: string }
    | { kind: "edit"; path: string; oldText: string; newText: string }
    | { kind: "fields"; fields: readonly { key: string; value: string; multiline: boolean }[] };
  readonly output: { lines: readonly string[]; previewCount: number } | null;
}
export function viewToolEntry(entry: ToolEntry): ToolCardView;
```
- Input normalization: `input` is `unknown` — accept objects; if a string, try `JSON.parse`; never
  throw.
- Per-tool table for: `run_shell`, `read_file`, `edit_file`, `write_file`, `web_search`, `lsp`,
  `todo_write`, `load_skill`, `consult_vision`, `youtube_transcript`, agent tools. Generic fallback
  for everything else.
- Result facts derived from `content`: line count, `no output` / `(empty file…)`, `[Command timed
  out]` → `timed out`, `[Output truncated…]` → `truncated`, edit `Replaced N occurrence(s)` →
  `N replacement(s)` (+ `diagnostics` badge when diagnostics are appended), write `(N bytes)` →
  `created/overwrote · size`.
- Exhaustive vitest coverage (pure, no mocks): each tool + fallback, malformed input, error,
  pending, orphan.

### Step 3 — Component (`src/features/chat/ui/ToolCard.svelte`, thin)
- Props: `entry: ToolEntry`. Calls `viewToolEntry`, renders `LazyCollapse` with the header
  (status glyph · name · `truncate` call summary · badges · `→ result summary`) and the lazily-mounted
  body (call detail + output with "⋯ N more lines" toggle).
- Header layout must stay one line: `min-w-0 truncate` on the summary, `shrink-0` on name/status/
  result summary. `LazyCollapse` may need a `min-w-0` on its title flex row.
- Accessible label: `Toggle tool call <name>`.

### Step 4 — Wire into `ChatView.svelte`
- Delete the `tool-call` / `tool-result` branches of `chunkRow` (they can no longer reach it).
- The tool-group branch renders `{#each entries as entry (entry.toolCallId)}<ToolCard {entry}/>`.
- Key update in `keyedRows` per Step 1.
- Update `ui.test.ts` / `ChatView.test.ts`: one card per call; header contains call + result
  summary; no standalone result card; pending spinner; error tint; orphan result card.

### Step 5 — Verify + live check
`bun install`, `bun run typecheck`, `bun run test` (×2), `bun run check`, `bun run build`. Then a
human visual pass via `bin/up` from `worktrees/tool-call-display/` (stop the main `bin/up` first —
same ports): a turn with a single shell call, a parallel batch, an error, an edit, a long output, a
streaming (pending) call, and a reload mid-turn (seal keeps open state).

No wire/contract change → no `backend-handoff.md` ask. Update `GLOSSARY.md` only if a new term is
coined.

---

## 4. Optional backend follow-up (not required)
Result summaries are heuristics over strings. If richer headers are wanted later (real exit code,
match counts, diff stats), the backend could add an optional structured `details` object to
`ToolResultChunk` (as oh-my-pi does). That would be a wire change via `backend-handoff.md` — out of
scope for this feature.

## 5. Open questions for the user
1. **Per-tool summaries vs. generic only?** Plan: a small per-tool table for Dispatch's built-in
   tools + a generic fallback. Alternative: generic heuristics only (less code, less precise).
2. **Batches**: keep the stacked-cards-in-one-bubble grouping for parallel calls (plan), or render
   every call as an independent card with no batch grouping?
3. **Icon**: status glyph (spinner/✓/✗) replacing the wrench, or keep the wrench + a status glyph?
4. **Default state**: all collapsed (today's behavior), or auto-expand errors?
5. **Output preview length** in the expanded body (plan: 12 lines then "⋯ N more lines").
