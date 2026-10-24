import type { ToolCallChunk, ToolResultChunk } from "@dispatch/wire";
import type { RenderedChunk } from "./types";

/** One tool call and its response. Null call = unloaded history; null result = pending. */
export interface ToolEntry {
  readonly recovering?: boolean;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly call: ToolCallChunk | null;
  readonly result: ToolResultChunk | null;
}

export type RenderGroup =
  | { readonly kind: "single"; readonly chunk: RenderedChunk }
  | {
      readonly kind: "tool";
      readonly entry: ToolEntry;
      readonly provisional: boolean;
      readonly stepId?: string;
      readonly turnId?: string;
    };

/**
 * One independent group per call, at the call's position, absorbing its result
 * by toolCallId (including legacy chunks without stepId). Orphan results stay
 * visible at their own position. First occurrence wins for duplicate ids, so
 * the stable t<toolCallId> render keys are always unique, even on corrupt replay.
 * Pure: input → output; no DOM, effects, or Svelte.
 */
export function groupRenderedChunks(
  rendered: readonly RenderedChunk[],
  recovering = false,
): readonly RenderGroup[] {
  const calls = new Map<string, RenderedChunk>();
  const results = new Map<string, RenderedChunk>();
  for (const rc of rendered) {
    const c = rc.chunk;
    if (c.type === "tool-call" && !calls.has(c.toolCallId)) calls.set(c.toolCallId, rc);
    if (c.type === "tool-result" && !results.has(c.toolCallId)) results.set(c.toolCallId, rc);
  }

  const groups: RenderGroup[] = [];
  const emitted = new Set<string>();
  for (const rc of rendered) {
    const c = rc.chunk;
    if (c.type !== "tool-call" && c.type !== "tool-result") {
      groups.push({ kind: "single", chunk: rc });
      continue;
    }
    if (emitted.has(c.toolCallId)) continue;
    // A matching call owns the card's position, even if the result came first.
    if (c.type === "tool-result" && calls.has(c.toolCallId)) continue;
    emitted.add(c.toolCallId);
    const callRow = calls.get(c.toolCallId);
    const resultRow = results.get(c.toolCallId);
    const call = callRow?.chunk.type === "tool-call" ? callRow.chunk : null;
    const result = resultRow?.chunk.type === "tool-result" ? resultRow.chunk : null;
    const stepId = call?.stepId ?? result?.stepId;
    const turnId = callRow?.turnId ?? resultRow?.turnId;
    groups.push({
      kind: "tool",
      entry: {
        toolCallId: c.toolCallId,
        toolName: call?.toolName ?? c.toolName,
        call,
        result,
        ...(recovering && call === null && resultRow?.provisional ? { recovering: true } : {}),
      },
      provisional: Boolean(callRow?.provisional || resultRow?.provisional),
      ...(stepId !== undefined ? { stepId } : {}),
      ...(turnId !== undefined ? { turnId } : {}),
    });
  }
  return groups;
}
