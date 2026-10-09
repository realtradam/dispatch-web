/**
 * Bench the PURE pipeline a tab runs when opening a conversation mid-turn:
 * history fetch → applyHistory → fold every replayed event (one render-pass
 * worth of derivations per event, like the UI does) .
 *   bun scripts/bench-pure.ts <conversationId> [scale]
 * `scale` synthesizes a longer turn by repeating the replay's step events.
 */
import {
  applyHistory,
  foldEvent,
  groupRenderedChunks,
  initialState,
  initialWindowSize,
  selectChunks,
  windowTranscript,
} from "../src/core/chunks/index.ts";
import { interleaveTurnMetrics } from "../src/core/metrics/index.ts";
import { renderMarkdown } from "../src/features/markdown/logic/markdown.ts";

const conv = process.argv[2] ?? "";
const HTTP = process.env.PROBE_HTTP ?? "http://localhost:24991";
const replay = JSON.parse(await Bun.file(`/tmp/replay-${conv}.json`).text()) as { type: string }[];
const hist = (await (await fetch(`${HTTP}/conversations/${conv}?sinceSeq=0`)).json()) as {
  chunks: { seq: number; turnId?: string; chunk: { type: string } }[];
};
const turnId = (replay.find((e) => e.type === "turn-start") as { turnId: string }).turnId;
const committedThisTurn = hist.chunks.filter((c) => c.turnId === turnId).length;
console.log(
  `history chunks=${hist.chunks.length} (of which current turn=${committedThisTurn}), replay events=${replay.length}`,
);

let state = windowTranscript(
  applyHistory(initialState(), hist.chunks as never),
  initialWindowSize(256),
);
let derive = 0;
let md = 0;
const t0 = performance.now();
for (const ev of replay) {
  state = foldEvent(state, ev as never);
  // What each per-event render recomputes in ChatView:
  const d0 = performance.now();
  const chunks = selectChunks(state);
  interleaveTurnMetrics(groupRenderedChunks(chunks), []);
  derive += performance.now() - d0;
  const last = chunks[chunks.length - 1];
  if (last?.streaming && last.chunk.type === "text") {
    const m0 = performance.now();
    renderMarkdown(last.chunk.text, { streaming: true });
    md += performance.now() - m0;
  }
}
const total = performance.now() - t0;
const rendered = selectChunks(state);
const dupTool = new Map<string, number>();
for (const r of rendered) {
  if (r.chunk.type === "tool-call" || r.chunk.type === "tool-result") {
    const k = `${r.chunk.type}:${(r.chunk as { toolCallId: string }).toolCallId}`;
    dupTool.set(k, (dupTool.get(k) ?? 0) + 1);
  }
}
const dups = [...dupTool.values()].filter((n) => n > 1).length;
console.log({
  renderedChunks: rendered.length,
  committed: state.committed.length,
  provisional: state.provisional.length,
  duplicatedToolChunks: dups,
  totalMs: Math.round(total),
  deriveMs: Math.round(derive),
  markdownFullRerenderMs: Math.round(md),
});
