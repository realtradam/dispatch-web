/**
 * Focused probe: load a selected conversation through the FE's REAL pure modules
 * and see whether the tab's render path would throw. Not part of the test suite.
 *
 *   bun scripts/probe-tab.ts <conversationId>
 */
import "fake-indexeddb/auto";
import type {
  ConversationHistoryResponse,
  ConversationMetricsResponse,
} from "@dispatch/transport-contract";
import {
  applyHistory,
  groupRenderedChunks,
  initialState,
  selectChunks,
  selectMessages,
} from "../src/core/chunks/index.ts";
import {
  applyDurableMetrics,
  initialMetricsState,
  selectOrderedTurnMetrics,
} from "../src/core/metrics/index.ts";

const HTTP_BASE = process.env.PROBE_HTTP ?? "http://localhost:24991";
const CONV = process.argv[2];
if (!CONV) {
  console.error("Usage: bun scripts/probe-tab.ts <conversationId>");
  process.exit(1);
}

async function historySync(id: string, sinceSeq: number): Promise<ConversationHistoryResponse> {
  const url = `${HTTP_BASE}/conversations/${encodeURIComponent(id)}?sinceSeq=${sinceSeq}`;
  const res = await fetch(url, { headers: { Origin: "http://localhost:24204" } });
  if (!res.ok) throw new Error(`history fetch ${res.status} for ${url}`);
  return (await res.json()) as ConversationHistoryResponse;
}

async function metricsSync(id: string): Promise<ConversationMetricsResponse> {
  const res = await fetch(`${HTTP_BASE}/conversations/${encodeURIComponent(id)}/metrics`, {
    headers: { Origin: "http://localhost:24204" },
  });
  if (!res.ok) throw new Error(`metrics fetch ${res.status}`);
  return (await res.json()) as ConversationMetricsResponse;
}

let failures = 0;
const record = (name: string, ok: boolean, detail?: string) => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "OK" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

console.log(`Probing conversation ${CONV} via ${HTTP_BASE}`);

// 1. applyHistory (the tab's cold-load path)
try {
  const hist = await historySync(CONV, 0);
  const chunks = hist.chunks ?? [];
  console.log(`  history: ${chunks.length} chunks, latestSeq=${hist.latestSeq}`);
  let state = initialState();
  try {
    state = applyHistory(state, chunks as never);
    record(
      `applyHistory(${chunks.length} chunks)`,
      true,
      `state=${JSON.stringify(state).length} bytes`,
    );
  } catch (e) {
    record("applyHistory", false, String(e));
  }

  // 2. selectMessages / selectChunks — what the transcript renders
  try {
    const messages = selectMessages(state);
    record("selectMessages", true, `${messages.length} messages`);
  } catch (e) {
    record("selectMessages", false, String(e));
  }

  // 3. groupRenderedChunks — the render grouping
  try {
    const grouped = groupRenderedChunks(selectChunks(state));
    record("groupRenderedChunks", true, `${grouped.length} groups`);
  } catch (e) {
    record("groupRenderedChunks", false, String(e));
  }
} catch (e) {
  record("history load", false, String(e));
}

// 4. metrics path
try {
  const m = await metricsSync(CONV);
  let ms = initialMetricsState();
  const turns = (m as { turns?: unknown[] }).turns ?? [];
  try {
    ms = applyDurableMetrics(ms, turns as never);
  } catch (e) {
    failures += 1;
    console.log(`  FAIL applyDurableMetrics — ${String(e)}`);
  }
  const ordered = selectOrderedTurnMetrics(ms);
  record(
    "metrics fold+apply",
    true,
    `${ordered.length} ordered turn metrics (${turns.length} turns)`,
  );
} catch (e) {
  record("metrics load", false, String(e));
}

console.log(failures === 0 ? "\nALL OK — tab render path is clean." : `\n${failures} FAILURE(S).`);
process.exit(failures === 0 ? 0 : 1);
