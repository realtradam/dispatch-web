import type {
  ConversationHistoryResponse,
  ConversationMetricsResponse,
} from "@dispatch/transport-contract";
import type { HistorySync, MetricsSync } from "../features/chat";

export function createHistorySync(httpBase: string, fetchImpl: typeof fetch): HistorySync {
  return async (conversationId, sinceSeq, window) => {
    let url = `${httpBase}/conversations/${encodeURIComponent(conversationId)}?sinceSeq=${sinceSeq}`;
    // CR-5 windowing (transport-contract@0.10.0): both must be positive
    // integers when present (the server 400s otherwise; callers guarantee it).
    if (window?.limit !== undefined) url += `&limit=${window.limit}`;
    if (window?.beforeSeq !== undefined) url += `&beforeSeq=${window.beforeSeq}`;
    const res = await fetchImpl(url);
    if (!res.ok) {
      throw new Error(`History sync failed: ${res.status}`);
    }
    const data = (await res.json()) as ConversationHistoryResponse;
    if (
      !data ||
      !Array.isArray(data.chunks) ||
      !Number.isSafeInteger(data.historyEpoch) ||
      data.historyEpoch < 0
    ) {
      throw new Error("Invalid history response");
    }
    return data;
  };
}

export function createMetricsSync(httpBase: string, fetchImpl: typeof fetch): MetricsSync {
  return async (conversationId: string) => {
    const url = `${httpBase}/conversations/${encodeURIComponent(conversationId)}/metrics`;
    const res = await fetchImpl(url);
    if (!res.ok) return { turns: [] };
    return (await res.json()) as ConversationMetricsResponse;
  };
}
