# Text-file embeds in chat Markdown

## User request (verbatim)

> I would like to add a new feature to the frontend: embedding of text files into the chat markdown. This is to save on the ai having to output verbatim content, when it can instead just link to it to show it in the chat. For example when making an new plan, it can just embed the plan. Or giving research, it can just embed it to display in the chat. This feature will also require a initial context update to explain to do this to the ai. Plan the feature and then summon a sol agent to implement it

## Goal

An assistant can save a plan, research report, or other text document to disk and reference it concisely in its reply. The chat displays that document inline without requiring the model to output its contents again. The reference remains the stored chat text; reading the embed for display must not inject its body back into model history.

## Observed integration points

- Frontend: `src/features/markdown/ui/Markdown.svelte`, `logic/markdown.ts`, and `logic/streaming-markdown.ts`. Rendering currently uses marked, highlight.js and DOMPurify. Its rendering core is synchronous/pure; streaming caches settled blocks separately from the changing tail.
- Chat wiring: `src/features/chat/ui/ChatView.svelte` supplies the Markdown component with the backend base URL and conversation cwd for local images. Audit the conversation computer context as well before resolving file references.
- Backend: `packages/transport-http/src/routes/images.ts` has a `/local-image` route; it serves local raster files, not text files. Inspect existing file/remote-execution contracts before introducing a text-serving seam.
- AI guidance: `packages/system-prompt/src/service.ts` defines `DEFAULT_TEMPLATE`, including existing image-embedding instructions. Stored custom templates take precedence over that fallback, and resolved prompts are persisted per conversation. Updating only the fallback may therefore not teach agents using an existing custom template. Trace the actual initial-context assembly and choose the appropriate non-destructive delivery point.

These are discovery pointers, not a mandate to copy the image route's filesystem policy or to restructure the renderer.

## Implementation plan

### 1. Define the reference contract

Implementation contract: a standalone paragraph link `[Plan](text-file:notes/plan.md)` opts into a text-file embed. An absolute path is also supported, e.g. `[Research](text-file:/tmp/research.md)`. For spaces use an angle-bracket destination, e.g. `[Research](<text-file:notes/research%20report.md>)`; percent escapes decode once after Markdown escapes, and literal percent signs use `%25`. Destinations are POSIX filesystem paths only, never `file:` URLs, HTTP URLs, tilde expansion, backslashes, or arbitrary network targets. Remote-computer text embeds are explicitly unsupported in this version (never fall back to reading the same path locally). A short labeled file reference is enough for an assistant to emit it. Ordinary Markdown links, images, inline code, and fenced code must retain their existing behavior. Syntax shown inside code must not fetch files.

The syntax and its supported path forms must be identical across parser, tests, and AI instructions. Support absolute paths and paths relative to the conversation cwd. Decide explicitly how file URLs, spaces/encoding, and remote-computer paths work. Reject unsupported destinations rather than accidentally reading the same path from a different computer. Do not silently add arbitrary remote HTTP fetching.

### 2. Provide bounded, authenticated file reads

Reuse suitable existing contracts if available; otherwise expose the smallest transport operation required by the frontend. Keep access within the existing authenticated/authorized transport boundary and validate all request inputs. Resolve against the correct conversation/computer context, not the browser URL or server process cwd.

Return text as data, never executable HTML. Bound file size and read work; handle non-regular files, binary/invalid text, unavailable paths, and remote errors gracefully. Ensure unsupported paths/protocols cannot become browser fetches or server-side URL fetches. Use a concrete, tested text-size policy and communicate any rejection or truncation in the UI. If extending contracts, follow package boundaries and existing route/composition patterns.

### 3. Display an inline document

Additional user requirement (verbatim):

> the inline text should render the markdown, but it should be inside of a block like how tool calls are inside of an expandable block. It should show ~the first and last 6 lines of text from the markdown, and have an expand button to show more.

This supersedes the generic document-container presentation. Render Markdown documents through the existing sanitized Markdown pipeline inside an expandable, tool-call-like block. The default preview displays rendered Markdown from approximately the first six and last six source lines, with a clear omission indicator between them; short documents must not duplicate overlapping lines. Provide an accessible Expand/Collapse control to show the full rendered document. Determine concrete styling from existing tool-call UI patterns. Both preview fragments and expanded content must be sanitized, preserve image-consent policy, and never recursively fetch nested embeds. Display other supported text/code files safely, preserving whitespace and using existing highlighting where suitable. Include the reference label/path so users can tell embedded content from the assistant's own prose.

Keep fetching in an effectful UI/adapter layer rather than making pure Markdown rendering perform I/O. Provide visible loading, empty-file, and failure states, with a practical retry path. A failure must not break the surrounding chat.

Integrate with streaming without repeatedly fetching on every token or replacing settled document state unnecessarily. Clean up stale requests on unmount/context changes and prevent late responses from rendering under a different path/conversation/computer. Repeated references should not cause uncontrolled duplicate work.

Embedded content is untrusted: sanitize it, preserve existing remote-image consent, and do not recursively fetch embeds found within an embedded document. Preserve the existing security policy for raw HTML and links. Keep rendering bounded for large files.

### 4. Specify persistence semantics

Document whether an embed displays the current on-disk file or a captured snapshot. Prefer the simplest coherent implementation using existing infrastructure; do not imply historical immutability if the file is fetched live. State what happens when a file changes or is deleted and how refresh/retry behaves. Snapshots, file watchers, editors, and broad attachment-system redesign are not required by this request.

### 5. Teach the AI in its initial context

Explain the actual implemented syntax with a plan/research example, supported path rules, and relevant limitations. Tell the assistant to finish saving the file before emitting its reference, to use embeds instead of repeating long saved content when useful, and to retain a short explanatory summary in its reply. Make clear that embedding displays the file to the user; it is not a substitute for reading a file the assistant itself needs to understand.

Verify guidance reaches the intended initial-context path for existing installations/custom templates without overwriting user-authored prompts. Respect existing prompt persistence semantics; explicitly report which conversations receive the new instructions and when. Add coverage for the delivery mechanism, not just a string assertion on an unused fallback.

### 6. Verify and commit

Read each repo's `AGENTS.md` and applicable scoped rules. Run `bun install` in both worktrees before verification. Implement within the isolated feature worktrees only, coordinating owners if delegating package work.

Cover at least:
- Parsing and path resolution, escaped/encoded paths, non-embed links/images/code, incomplete streaming syntax.
- Markdown and plain-text display, XSS attempts, nested embeds, existing image-consent behavior.
- Loading, missing/empty/oversized/binary files, retry, context switches, stale responses, repeated references.
- Backend validation/access behavior and correct computer routing or explicit unsupported-computer rejection.
- Initial-context guidance and custom-template compatibility.
- End-to-end scenario: save a plan file, emit only its embed plus a short summary, and see its formatted contents in chat; reload and error behavior match documented semantics.

Run frontend typecheck, tests, formatting/lint checks and production build. Run applicable backend typecheck, tests (including Bun-specific transport coverage as appropriate), formatting/lint checks and build verification according to its architecture guidance. Report pre-existing failures distinctly; do not silently claim passing checks.

Commit verified work in both repositories on `feature/text-file-embeds`. Include final syntax, lifecycle semantics, verification results, and any limitations in the implementation report. Do not merge or push.

## Acceptance criteria

1. A short file reference displays a saved plan/research document inline in assistant chat without repeating its body in the model reply, inside a tool-call-like expandable block with rendered first/last approximately six-source-line previews and Expand/Collapse.
2. Existing ordinary Markdown behavior remains intact, including streamed messages.
3. File I/O and document rendering are bounded and remain within the existing transport trust and sanitization policies. The audited existing trust boundary is Host/Origin plus trusted-network deployment, not per-user/session authentication.
4. The AI receives accurate initial-context instructions through a verified path, without destroying custom prompts.
5. Both repositories contain committed, verified work on the feature branch; `dev` remains untouched.

## Handoff

This plan defines user-visible goals, integration observations, and acceptance criteria. The Sol implementation agent owns technical design, including final syntax and the minimal appropriate contract/architecture. Do not treat illustrative approaches as additional user requirements. Resolve details by inspecting the codebase and record the chosen behavior in the report.

## Implementation outcome

Implemented and verified; authoritative final syntax, lifecycle, context delivery,
limits and verification caveats are recorded in
`notes/text-file-embeds-implementation.md`. Existing persisted prompts are not migrated;
remote computer embeds are explicitly unsupported. The user requested no subagents
during implementation; all delegated generations were stopped and remaining work
was completed directly. No merge, push or shared deployment.
