import type { StepId } from "@dispatch/wire";
import { render, screen } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";
import type { RenderedChunk } from "../../../core/chunks";
import ChatView from "./ChatView.svelte";

// Defensive rendering: a conversation transcript can contain duplicate
// `toolCallId`s (provider double-emission, persisted — e.g. PII_REDACTED_CONVERSATION_SHORT_01). The
// grouped render path MUST dedupe them so the keyed {#each} never throws
// Svelte `each_key_duplicate` (which aborts the reactive flush and makes the
// tab appear dead). See fix-toolcall-duplicate-keys plan Part 1.
describe("ChatView — duplicate toolCallIds", () => {
  it("renders a tool batch with duplicated toolCallIds without throwing, showing one card per unique call", () => {
    const chunks: RenderedChunk[] = [
      {
        seq: 1,
        role: "assistant",
        chunk: {
          type: "tool-call",
          toolCallId: "a",
          toolName: "read_file",
          input: { path: "/a" },
          stepId: "t1#0" as StepId,
        },
        provisional: false,
      },
      {
        seq: 2,
        role: "assistant",
        chunk: {
          type: "tool-call",
          toolCallId: "b",
          toolName: "list_dir",
          input: { path: "/b" },
          stepId: "t1#0" as StepId,
        },
        provisional: false,
      },
      // The PII_REDACTED_CONVERSATION_SHORT_01 pattern: the same ids re-emitted immediately after.
      {
        seq: 3,
        role: "assistant",
        chunk: {
          type: "tool-call",
          toolCallId: "a",
          toolName: "read_file",
          input: { path: "/a" },
          stepId: "t1#0" as StepId,
        },
        provisional: false,
      },
      {
        seq: 4,
        role: "assistant",
        chunk: {
          type: "tool-call",
          toolCallId: "b",
          toolName: "list_dir",
          input: { path: "/b" },
          stepId: "t1#0" as StepId,
        },
        provisional: false,
      },
      {
        seq: 5,
        role: "tool",
        chunk: {
          type: "tool-result",
          toolCallId: "a",
          toolName: "read_file",
          content: "contents-of-a",
          isError: false,
          stepId: "t1#0" as StepId,
        },
        provisional: false,
      },
      {
        seq: 6,
        role: "tool",
        chunk: {
          type: "tool-result",
          toolCallId: "b",
          toolName: "list_dir",
          content: "contents-of-b",
          isError: false,
          stepId: "t1#0" as StepId,
        },
        provisional: false,
      },
      // Duplicate results too — absorbed into the single deduped batch.
      {
        seq: 7,
        role: "tool",
        chunk: {
          type: "tool-result",
          toolCallId: "a",
          toolName: "read_file",
          content: "contents-of-a",
          isError: false,
          stepId: "t1#0" as StepId,
        },
        provisional: false,
      },
      {
        seq: 8,
        role: "tool",
        chunk: {
          type: "tool-result",
          toolCallId: "b",
          toolName: "list_dir",
          content: "contents-of-b",
          isError: false,
          stepId: "t1#0" as StepId,
        },
        provisional: false,
      },
    ];

    const { container } = render(ChatView, { props: { chunks } });

    // No each_key_duplicate crash. Batched calls render as collapsible cards —
    // exactly ONE per unique toolCallId (deduped), not 4.
    const collapses = container.querySelectorAll(".collapse");
    expect(collapses).toHaveLength(2);

    // Both unique tool names shown; each result rendered once (deduped).
    expect(screen.getByText("read_file")).toBeInTheDocument();
    expect(screen.getByText("list_dir")).toBeInTheDocument();
    expect(screen.getByText("contents-of-a")).toBeInTheDocument();
    expect(screen.getByText("contents-of-b")).toBeInTheDocument();
  });
});
