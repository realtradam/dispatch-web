# Roadmap — dispatch-web

> Living document of shipped + planned FE work. Updated at each milestone.
> Source of truth for "what's done" + "what's next". Cross-repo handoffs land here
> as committed work (see `backend-handoff.md` for the living backend seam).

## Done

- **Surface system + WS** — generic surface interpreter, catalog subscribe, `SurfaceView` dispatch on field kind (never surface id); custom renderers for `table`, `message-queue`, `todo`.
- **Conversation transcript** — chunk cache + delta streaming (`core/chunks`), provisional → committed fold, IndexedDB persistence, chat-limit bulk unload + 75% fresh-load window + show-earlier backfill (CR-5 `?limit=`/`?beforeSeq=`).
- **Tabs + model selector** — per-conversation tabs (persisted), model catalog, draft → tab promotion on first send.
- **Multi-client live view** — `chat.subscribe`/`chat.unsubscribe`, structural `generating` flag, resync on reconnect, `user-message` event (CR-3 fix).
- **Cache-warming** — toggle + interval, manual warm, authoritative `nextWarmAt` timer + retention, `POST /conversations/:id/close` (CR-4 lifecycle).
- **Per-conversation cwd + LSP** — `GET`/`PUT /cwd`, `GET /lsp` (lazy spawn), draft cwd carries into turn 1.
- **Context size** — `done.contextSize` + `TurnMetrics.contextSize`, composer fill bar (placeholder 1M limit).
- **Reasoning effort** — sticky per-conversation thinking-depth knob (`GET`/`PUT /reasoning-effort`, `null` ⇒ default `high`).
- **Message queue + steering** — `chat.queue` WS op, `steering` AgentEvent → user bubble in transcript, message-queue surface panel above composer.
- **Todo task list** — `rendererId: "todo"` custom renderer, dedicated "Tasks" sidebar view (status indicators: pending/in_progress/completed/cancelled).
- **Conversation.open broadcast** — `conversation.open` WS message handler, opens/focuses a tab from CLI `--open` flag.

## Next up

### Conversation list + title editing (`frontend-conversation-list-handoff.md`)

Types already in `wire@0.9.0` + `transport-contract@0.13.0` (mirrored, deps re-pinned). The `conversation.open` WS handler is already consumed. Remaining FE work:

1. **Conversation list sidebar view** — `GET /conversations` → `ConversationListResponse` (`ConversationMeta[]` with id, title, createdAt, lastActivityAt). Render a "Conversations" sidebar view (title + relative time). Click to open (create tab + load history + subscribe). Fetch on mount + on focus / manual refresh.
2. **Title editing** — `GET`/`PUT /conversations/:id/title` (`TitleResponse`/`SetTitleRequest`). Inline rename affordance on the active conversation's title. Auto-title from first user message is backend-owned; FE overrides via PUT.

## Backlog (likely next backend asks — not yet requested)

- **Model max context-window LIMIT** — the denominator for the context-size fill bar (currently hardcoded `1_000_000` in `Composer.svelte`). Wire the real per-model `contextWindow` when the backend ships it.
- **LSP status over WS (push)** — today the FE HTTP-polls `GET /lsp` on mount + manual refresh; a live surface/WS push would remove the manual refresh and reflect server state changes without a reload.
- **Warming opt-in persistence across backend restarts** — currently fail-safe-off after a restart; backend offered boot hydration if it becomes a need.
- **Standalone "stop generating" button** — `POST /conversations/:id/close` aborts AND disables warming; a separate "stop without closing" affordance would need its own op if the product wants it.
- **`GET /conversations/:id/last`** — blocking last-message endpoint (shipped, mirrored, not consumed). Could be used for notification previews or conversation list snippets.
