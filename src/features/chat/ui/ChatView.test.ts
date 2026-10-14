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
  it("renders duplicated toolCallIds without throwing, showing one bubble per unique call", async () => {
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
      // Duplicate results too — absorbed into the corresponding cards.
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

    // No each_key_duplicate crash. Calls render as independent collapsible cards —
    // exactly ONE per unique toolCallId (deduped), not 4.
    const collapses = container.querySelectorAll(".collapse");
    expect(collapses).toHaveLength(2);
    expect(container.querySelectorAll(".chat-bubble")).toHaveLength(2);

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

    const box = screen.getByRole("checkbox", { name: "Toggle tool call run_shell" });
    await userEvent.click(box);
    expect(screen.getByText("HUGE-OUTPUT")).toBeInTheDocument();

    await userEvent.click(box); // close: body stays mounted (close animation)
    expect(screen.getByText("HUGE-OUTPUT")).toBeInTheDocument();
    expect(container.querySelectorAll(".chat-row")).toHaveLength(1);
  });
});

function shellChunks(content: string | null, isError = false, committed = false): RenderedChunk[] {
  const call: RenderedChunk = {
    seq: committed ? 1 : null,
    role: "assistant",
    provisional: !committed,
    chunk: {
      type: "tool-call",
      toolCallId: "shell-1",
      toolName: "run_shell",
      input: { command: "bun run test" },
    },
  };
  return content === null
    ? [call]
    : [
        call,
        {
          seq: committed ? 2 : null,
          role: "tool",
          provisional: !committed,
          chunk: {
            type: "tool-result",
            toolCallId: "shell-1",
            toolName: "run_shell",
            content,
            isError,
          },
        },
      ];
}

describe("ChatView — tool cards", () => {
  it("pairs a single call/result into one collapsed bubble with both summaries and a success icon", async () => {
    const { container } = render(ChatView, { props: { chunks: shellChunks("first\nsecond") } });
    expect(container.querySelectorAll(".chat-bubble")).toHaveLength(1);
    expect(container.querySelectorAll(".collapse")).toHaveLength(1);
    expect(screen.getByText("bun run test")).toBeInTheDocument();
    expect(screen.getByText("→ 2 lines")).toBeInTheDocument();
    expect(screen.getByLabelText("Succeeded")).toHaveTextContent("✓");
    const box = screen.getByRole("checkbox", { name: "Toggle tool call run_shell" });
    expect(box).not.toBeChecked();
    expect(container.querySelector("pre")).toBeNull();
    await userEvent.click(box);
    expect(screen.getByText("$ bun run test")).toBeInTheDocument();
    expect(screen.getByText("first second")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /tool result/ })).toBeNull();
  });
  it("transitions pending → result → sealed without losing open state", async () => {
    const { container, rerender } = render(ChatView, { props: { chunks: shellChunks(null) } });
    expect(screen.getByLabelText("Running")).toHaveClass("loading-spinner");
    expect(container.querySelector(".collapse-title")).not.toHaveTextContent("→");
    const box = screen.getByRole("checkbox", { name: "Toggle tool call run_shell" });
    await userEvent.click(box);
    expect(screen.getByText("running…")).toBeInTheDocument();
    await rerender({ chunks: shellChunks("done") });
    expect(screen.queryByLabelText("Running")).toBeNull();
    expect(screen.getByLabelText("Succeeded")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Toggle tool call run_shell" })).toBe(box);
    expect(box).toBeChecked();
    await rerender({ chunks: shellChunks("done", false, true) });
    expect(screen.getByRole("checkbox", { name: "Toggle tool call run_shell" })).toBe(box);
    expect(box).toBeChecked();
    expect(screen.getByText("done")).toBeInTheDocument();
  });
  it("keeps errors collapsed with a failure icon and tints the expanded output", async () => {
    const { container } = render(ChatView, {
      props: { chunks: shellChunks("Permission denied", true) },
    });
    const box = screen.getByRole("checkbox", { name: "Toggle tool call run_shell" });
    expect(box).not.toBeChecked();
    expect(screen.getByLabelText("Failed")).toHaveClass("text-error");
    expect(screen.getByLabelText("Failed")).toHaveTextContent("✗");
    expect(screen.getByText("→ failed").closest(".tool-result")).toHaveClass("text-error");
    expect(container.querySelector(".tool-header")).not.toHaveTextContent("Permission denied");
    expect(container.querySelector("pre")).toBeNull();
    await userEvent.click(box);
    expect(screen.getByText("Permission denied").parentElement).toHaveClass("text-error");
  });
  it("renders an orphan result as the same card and retains state when its call is paged back in", async () => {
    const chunks = shellChunks("contents", false, true);
    const { container, rerender } = render(ChatView, { props: { chunks: chunks.slice(1) } });
    expect(container.querySelectorAll(".chat-bubble")).toHaveLength(1);
    expect(screen.getByText("Call in earlier history")).toHaveClass("earlier-history");
    expect(screen.getByLabelText("Succeeded")).toHaveClass("opacity-60");
    const box = screen.getByRole("checkbox", { name: "Toggle tool call run_shell" });
    await userEvent.click(box);
    expect(screen.getByText(/The call is in earlier, unloaded history/)).toBeInTheDocument();
    expect(screen.getByText("contents")).toBeInTheDocument();
    await rerender({ chunks });
    expect(screen.getByRole("checkbox", { name: "Toggle tool call run_shell" })).toBe(box);
    expect(box).toBeChecked();
    expect(screen.getByText("$ bun run test")).toBeInTheDocument();
  });
  it("folds 13 output lines as 6 + toggle + 6, expands and collapses without closing the card", async () => {
    const output = Array.from({ length: 13 }, (_, i) => `output-${i + 1}`).join("\n");
    const { rerender } = render(ChatView, { props: { chunks: shellChunks(output) } });
    const box = screen.getByRole("checkbox", { name: "Toggle tool call run_shell" });
    await userEvent.click(box);
    const response = screen.getByRole("region", { name: "Response" });
    expect(response).toHaveTextContent("output-1");
    expect(response).toHaveTextContent("output-6");
    expect(response).not.toHaveTextContent("output-7");
    expect(response).toHaveTextContent("output-8");
    expect(response).toHaveTextContent("output-13");
    const toggle = screen.getByRole("button", { name: "⋯ 1 more lines" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(toggle);
    expect(response).toHaveTextContent("output-7");
    expect(response.querySelectorAll("pre")).toHaveLength(1);
    expect(response.querySelector("pre")?.textContent).toBe(output);
    const fewer = screen.getByRole("button", { name: "Show fewer lines" });
    expect(fewer).toHaveClass("btn-primary", "btn-sm");
    expect(fewer.parentElement).toHaveClass("sticky-controls");
    const fullOutput = response.querySelector("pre");
    if (fullOutput === null) throw new Error("expected full output");
    expect(fewer.compareDocumentPosition(fullOutput)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(box).toBeChecked();
    expect(screen.getByRole("button", { name: "Show fewer lines" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await userEvent.click(screen.getByRole("button", { name: "Show fewer lines" }));
    expect(response).not.toHaveTextContent("output-7");
    expect(box).toBeChecked();
    // The separate output-fold state also survives sealing.
    await userEvent.click(screen.getByRole("button", { name: "⋯ 1 more lines" }));
    expect(response).toHaveTextContent("output-7");
    await rerender({ chunks: shellChunks(output, false, true) });
    expect(box).toBeChecked();
    expect(screen.getByRole("button", { name: "Show fewer lines" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(response).toHaveTextContent("output-7");
  });
  it("shows 12 output lines without an inner toggle", async () => {
    const output = Array.from({ length: 12 }, (_, i) => `output-${i + 1}`).join("\n");
    render(ChatView, { props: { chunks: shellChunks(output) } });
    await userEvent.click(screen.getByRole("checkbox", { name: "Toggle tool call run_shell" }));
    expect(screen.queryByRole("button", { name: /more lines|fewer lines/ })).toBeNull();
    expect(screen.getByRole("region", { name: "Response" })).toHaveTextContent("output-12");
  });
  it("renders edit details and treats tool output as text, not executable markup", async () => {
    const chunks: RenderedChunk[] = [
      {
        seq: 1,
        role: "assistant",
        provisional: false,
        chunk: {
          type: "tool-call",
          toolCallId: "edit",
          toolName: "edit_file",
          input: { path: "a.ts", oldString: "before", newString: "after\nsecond" },
        },
      },
      {
        seq: 2,
        role: "tool",
        provisional: false,
        chunk: {
          type: "tool-result",
          toolCallId: "edit",
          toolName: "edit_file",
          content: 'Replaced 1 occurrence(s) in "a.ts".\n<script>alert(1)</script>',
          isError: false,
        },
      },
    ];
    const { container } = render(ChatView, { props: { chunks } });
    expect(screen.getByText("+2")).toHaveClass("text-success");
    expect(screen.getByText("−1")).toHaveClass("text-error");
    expect(screen.getByText("→ 1 replacement · diagnostics")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("checkbox", { name: "Toggle tool call edit_file" }));
    expect(screen.getByText("before")).toHaveClass("text-error");
    expect(screen.getByText("after second")).toHaveClass("text-success");
    expect(container.querySelector("script")).toBeNull();
    expect(container).toHaveTextContent("<script>alert(1)</script>");
  });
});

it("renders compact, aligned generic fields with legible headings and inline scalar arrays", async () => {
  const chunks: RenderedChunk[] = [
    {
      seq: 1,
      role: "assistant",
      provisional: false,
      chunk: {
        type: "tool-call",
        toolCallId: "issue",
        toolName: "mcp__github__create_issue",
        input: {
          owner: "realtradam",
          repo: "frontend",
          title: "Tool cards",
          labels: ["ui", "chat"],
          options: { nested: true },
        },
      },
    },
  ];
  const { container } = render(ChatView, { props: { chunks } });
  await userEvent.click(
    screen.getByRole("checkbox", { name: "Toggle tool call mcp__github__create_issue" }),
  );
  for (const name of ["Call", "Response"]) {
    expect(screen.getByRole("heading", { name })).toHaveClass("font-semibold", "text-base-content");
  }
  const call = screen.getByRole("region", { name: "Call" });
  expect(call.querySelector("dl")).toHaveClass("call-fields");
  expect(screen.getByText("owner")).toHaveClass("font-semibold", "text-base-content/85");
  const labels = screen.getByText('["ui", "chat"]');
  expect(labels.tagName).toBe("PRE");
  expect(labels.textContent).not.toContain("\n");
  expect(container.querySelectorAll("dt")).toHaveLength(5);
  expect(container.querySelectorAll("dd")).toHaveLength(5);
  expect(screen.getByText("options").nextElementSibling).toHaveTextContent('"nested": true');
});
