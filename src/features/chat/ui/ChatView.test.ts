import type { StepId } from "@dispatch/wire";
import { render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { RenderedChunk } from "../../../core/chunks";
import ChatView from "./ChatView.svelte";

/** Collapsed card bodies render lazily — open every card so its body mounts. */
async function openAllCollapses(container: HTMLElement): Promise<void> {
  const boxes = container.querySelectorAll<HTMLInputElement>('.collapse > input[type="checkbox"]');
  for (const box of boxes) {
    if (!box.checked) await userEvent.click(box);
  }
}

// Defensive rendering: a conversation transcript can contain duplicate
// `toolCallId`s (provider double-emission, persisted — e.g. PII_REDACTED_CONVERSATION_SHORT_01). The
// grouped render path MUST dedupe them so the keyed {#each} never throws
// Svelte `each_key_duplicate` (which aborts the reactive flush and makes the
// tab appear dead). See fix-toolcall-duplicate-keys plan Part 1.
describe("ChatView — duplicate toolCallIds", () => {
  it("renders a tool batch with duplicated toolCallIds without throwing, showing one card per unique call", async () => {
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
    await openAllCollapses(container);

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

describe("ChatView — lazy collapse bodies", () => {
  it("does not mount a collapsed card's body until it is first opened, then keeps it", async () => {
    const chunks: RenderedChunk[] = [
      {
        seq: 1,
        role: "tool",
        chunk: {
          type: "tool-result",
          toolCallId: "x",
          toolName: "run_shell",
          content: "HUGE-OUTPUT",
          isError: false,
        },
        provisional: false,
      },
    ];
    const { container } = render(ChatView, { props: { chunks } });
    expect(screen.getByText("run_shell")).toBeInTheDocument();
    expect(screen.queryByText("HUGE-OUTPUT")).toBeNull();

    const box = screen.getByRole("checkbox", { name: "Toggle tool result" });
    await userEvent.click(box);
    expect(screen.getByText("HUGE-OUTPUT")).toBeInTheDocument();

    await userEvent.click(box); // close: body stays mounted (close animation)
    expect(screen.getByText("HUGE-OUTPUT")).toBeInTheDocument();
    expect(container.querySelectorAll(".chat-row")).toHaveLength(1);
  });
});
