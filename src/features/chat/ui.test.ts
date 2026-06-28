import type { StepId } from "@dispatch/wire";
import { render, screen, within } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { RenderedChunk } from "../../core/chunks";
import type { TurnMetricsEntry } from "../../core/metrics";
import ChatView from "./ui/ChatView.svelte";
import Composer from "./ui/Composer.svelte";
import ModelSelector from "./ui/ModelSelector.svelte";
import ReasoningEffortSelector from "./ui/ReasoningEffortSelector.svelte";

describe("ChatView", () => {
  it("renders a message's text chunk", () => {
    const chunks: RenderedChunk[] = [
      {
        seq: 1,
        role: "assistant",
        chunk: { type: "text", text: "Hello world" },
        provisional: false,
      },
    ];

    render(ChatView, { props: { chunks } });

    expect(screen.getByText("Hello world")).toBeInTheDocument();
  });

  it("renders multiple chunks", () => {
    const chunks: RenderedChunk[] = [
      { seq: 1, role: "user", chunk: { type: "text", text: "Hi there" }, provisional: false },
      {
        seq: 2,
        role: "assistant",
        chunk: { type: "text", text: "Hello!" },
        provisional: false,
      },
    ];

    render(ChatView, { props: { chunks } });

    expect(screen.getByText("Hi there")).toBeInTheDocument();
    expect(screen.getByText("Hello!")).toBeInTheDocument();
  });

  it("shows the show-earlier button only when earlier history is unloaded, and pages it in", async () => {
    const chunks: RenderedChunk[] = [
      { seq: 26, role: "user", chunk: { type: "text", text: "later" }, provisional: false },
    ];

    let resolveEarlier: (() => void) | undefined;
    const onShowEarlier = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveEarlier = resolve;
        }),
    );

    render(ChatView, { props: { chunks, hasEarlier: true, onShowEarlier } });

    const button = screen.getByRole("button", { name: /show earlier messages/i });
    const user = userEvent.setup();
    await user.click(button);

    expect(onShowEarlier).toHaveBeenCalledTimes(1);
    // While the page-in is awaited the button is disabled (no double-fire).
    expect(screen.getByRole("button", { name: /loading earlier messages/i })).toBeDisabled();

    resolveEarlier?.();
    await vi.waitFor(() => {
      expect(screen.getByRole("button", { name: /show earlier messages/i })).toBeEnabled();
    });
  });

  it("hides the show-earlier button when nothing is unloaded", () => {
    const chunks: RenderedChunk[] = [
      { seq: 1, role: "user", chunk: { type: "text", text: "all here" }, provisional: false },
    ];

    render(ChatView, { props: { chunks, hasEarlier: false, onShowEarlier: vi.fn() } });

    expect(screen.queryByRole("button", { name: /show earlier/i })).not.toBeInTheDocument();
  });

  it("renders tool-call chunks", () => {
    const chunks: RenderedChunk[] = [
      {
        seq: 1,
        role: "assistant",
        chunk: {
          type: "tool-call",
          toolCallId: "tc1",
          toolName: "read_file",
          input: { path: "/tmp/test.txt" },
        },
        provisional: false,
      },
    ];

    render(ChatView, { props: { chunks } });

    expect(screen.getByText("read_file")).toBeInTheDocument();
    const pre = screen.getByText((content, element) => {
      return element?.tagName === "PRE" && content.includes("/tmp/test.txt");
    });
    expect(pre).toBeInTheDocument();
  });

  it("renders tool-result chunks", () => {
    const chunks: RenderedChunk[] = [
      {
        seq: 1,
        role: "tool",
        chunk: {
          type: "tool-result",
          toolCallId: "tc1",
          toolName: "read_file",
          content: "file contents here",
          isError: false,
        },
        provisional: false,
      },
    ];

    render(ChatView, { props: { chunks } });

    expect(screen.getByText("read_file")).toBeInTheDocument();
    expect(screen.getByText("file contents here")).toBeInTheDocument();
  });

  it("renders error chunks with alert role", () => {
    const chunks: RenderedChunk[] = [
      {
        seq: 1,
        role: "assistant",
        chunk: { type: "error", message: "Something failed" },
        provisional: false,
      },
    ];

    render(ChatView, { props: { chunks } });

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Something failed");
  });

  it("renders error chunks with code", () => {
    const chunks: RenderedChunk[] = [
      {
        seq: 1,
        role: "assistant",
        chunk: { type: "error", message: "Rate limited", code: "RATE_LIMIT" },
        provisional: false,
      },
    ];

    render(ChatView, { props: { chunks } });

    expect(screen.getByText("Rate limited")).toBeInTheDocument();
    expect(screen.getByText("[RATE_LIMIT]")).toBeInTheDocument();
  });

  it("renders system chunks", () => {
    const chunks: RenderedChunk[] = [
      {
        seq: 1,
        role: "system",
        chunk: { type: "system", text: "System context loaded" },
        provisional: false,
      },
    ];

    render(ChatView, { props: { chunks } });

    expect(screen.getByText("System context loaded")).toBeInTheDocument();
  });

  it("renders provisional (in-flight) chunks without any dimming", () => {
    const chunks: RenderedChunk[] = [
      {
        seq: null,
        role: "assistant",
        chunk: { type: "text", text: "Streaming..." },
        provisional: true,
      },
    ];

    render(ChatView, { props: { chunks } });

    // In-flight chunks render at full opacity (no faded "disabled" look).
    const wrapper = screen.getByText("Streaming...").closest("div");
    expect(wrapper).not.toHaveClass("opacity-50");
  });

  it("renders empty transcript", () => {
    render(ChatView, { props: { chunks: [] } });

    const log = screen.getByRole("log");
    expect(log).toBeInTheDocument();
    expect(log.children).toHaveLength(0);
  });

  it("groups batched tool calls (shared stepId) into one DaisyUI list", () => {
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
      {
        seq: 3,
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
    ];

    const { container } = render(ChatView, { props: { chunks } });

    // Batched calls render as collapsible cards (one per call), not a list.
    const collapses = container.querySelectorAll(".collapse");
    expect(collapses).toHaveLength(2);

    // Both call names + the available result are shown; the result is absorbed
    // (no standalone tool-result card).
    expect(screen.getByText("read_file")).toBeInTheDocument();
    expect(screen.getByText("list_dir")).toBeInTheDocument();
    expect(screen.getByText("contents-of-a")).toBeInTheDocument();
  });

  it("thinking is a checkbox collapse (no arrow) inside a visible bubble", () => {
    const chunks: RenderedChunk[] = [
      {
        seq: null,
        role: "assistant",
        chunk: { type: "thinking", text: "Let me think..." },
        provisional: true,
        streaming: true,
      },
    ];

    const { container } = render(ChatView, { props: { chunks } });

    const collapse = container.querySelector(".collapse");
    expect(collapse).not.toBeNull();
    expect(collapse).not.toHaveClass("collapse-arrow"); // no indicator icon
    expect(collapse).not.toHaveClass("collapse-plus");
    // Visible bubble, like tool cards.
    expect(collapse).toHaveClass("bg-base-200");
    expect(collapse).toHaveClass("rounded-box");
    expect(screen.getByRole("checkbox", { name: "Toggle thoughts" })).toBeInTheDocument();
  });

  it("title is 'Thinking' + dots while streaming, then 'Thoughts' with no dots once complete; open state persists", async () => {
    const streaming: RenderedChunk[] = [
      {
        seq: null,
        role: "assistant",
        chunk: { type: "thinking", text: "hmm" },
        provisional: true,
        streaming: true,
      },
    ];

    const { container, rerender } = render(ChatView, { props: { chunks: streaming } });

    // Streaming: "Thinking" + loading dots.
    expect(screen.getByText("Thinking")).toBeInTheDocument();
    expect(screen.queryByText("Thoughts")).toBeNull();
    expect(container.querySelector(".loading")).not.toBeNull();

    // Open it.
    const checkbox = screen.getByRole("checkbox", { name: "Toggle thoughts" });
    await userEvent.click(checkbox);
    expect(checkbox).toBeChecked();

    // Transition generating → completed/committed (seq assigned, no longer streaming).
    await rerender({
      chunks: [
        {
          seq: 1,
          role: "assistant",
          chunk: { type: "thinking", text: "hmm, all done" },
          provisional: false,
        },
      ],
    });

    // Completed: "Thoughts", no dots — and the open state survived the transition.
    expect(screen.getByText("Thoughts")).toBeInTheDocument();
    expect(screen.queryByText("Thinking")).toBeNull();
    expect(container.querySelector(".loading")).toBeNull();
    expect(screen.getByRole("checkbox", { name: "Toggle thoughts" })).toBeChecked();
    expect(container).toHaveTextContent("hmm, all done");
  });

  it("renders step and turn metrics as separate rows", () => {
    const chunks: RenderedChunk[] = [
      { seq: 1, role: "user", chunk: { type: "text", text: "Hi" }, provisional: false },
      {
        seq: 2,
        role: "assistant",
        chunk: { type: "text", text: "Hello!" },
        provisional: false,
      },
      {
        seq: 3,
        role: "assistant",
        chunk: {
          type: "tool-call",
          toolCallId: "tc1",
          toolName: "test",
          input: {},
          stepId: "t1#0" as StepId,
        },
        provisional: false,
      },
    ];

    const turnMetrics: TurnMetricsEntry[] = [
      {
        turnId: "t1",
        steps: [
          {
            stepId: "t1#0" as StepId,
            usage: { inputTokens: 100, outputTokens: 50 },
            genTotalMs: 800,
          },
        ],
        total: {
          turnId: "t1",
          usage: { inputTokens: 100, outputTokens: 50 },
          durationMs: 1200,
          steps: [
            {
              stepId: "t1#0" as StepId,
              usage: { inputTokens: 100, outputTokens: 50 },
              genTotalMs: 800,
            },
          ],
        },
      },
    ];

    render(ChatView, { props: { chunks, turnMetrics } });

    expect(screen.getByText("Hi")).toBeInTheDocument();
    expect(screen.getByText("Hello!")).toBeInTheDocument();
    expect(screen.getByText(/step 1/)).toBeInTheDocument();
    expect(screen.getAllByText(/150 tok/)).toHaveLength(2);
    expect(screen.getByText(/turn 1 · 150 tok \(100 in \/ 50 out\)/)).toBeInTheDocument();
    expect(screen.getByText(/1\.2s/)).toBeInTheDocument();
  });

  it("renders cache hit-rate badges (Last turn + Chat Total) coloured by level", () => {
    const chunks: RenderedChunk[] = [
      { seq: 1, role: "user", chunk: { type: "text", text: "Hi" }, provisional: false },
      {
        seq: 2,
        role: "assistant",
        chunk: { type: "text", text: "Hello!" },
        provisional: false,
      },
    ];
    const turnMetrics: TurnMetricsEntry[] = [
      {
        turnId: "t1",
        steps: [],
        total: {
          turnId: "t1",
          usage: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 93 },
          steps: [],
        },
      },
    ];

    const { container } = render(ChatView, { props: { chunks, turnMetrics } });

    expect(screen.getByText("Last turn:")).toBeInTheDocument();
    expect(screen.getByText("Chat Total:")).toBeInTheDocument();
    // single turn ⇒ both the turn rate and the cumulative are 93% ⇒ success badge
    const badges = container.querySelectorAll(".badge");
    expect(badges).toHaveLength(2);
    for (const b of badges) {
      expect(b.textContent).toBe("93%");
      expect(b.classList.contains("badge-success")).toBe(true);
    }
  });

  it("renders step-metrics inline after tool group", () => {
    const chunks: RenderedChunk[] = [
      { seq: 1, role: "user", chunk: { type: "text", text: "Run it" }, provisional: false },
      {
        seq: 2,
        role: "assistant",
        chunk: {
          type: "tool-call",
          toolCallId: "tc1",
          toolName: "bash",
          input: { command: "ls" },
          stepId: "t1#0" as StepId,
        },
        provisional: false,
      },
      {
        seq: 3,
        role: "tool",
        chunk: {
          type: "tool-result",
          toolCallId: "tc1",
          toolName: "bash",
          content: "file.txt",
          isError: false,
          stepId: "t1#0" as StepId,
        },
        provisional: false,
      },
      {
        seq: 4,
        role: "assistant",
        chunk: { type: "text", text: "Done!" },
        provisional: false,
      },
    ];

    const turnMetrics: TurnMetricsEntry[] = [
      {
        turnId: "t1",
        steps: [
          {
            stepId: "t1#0" as StepId,
            usage: { inputTokens: 80, outputTokens: 20 },
            genTotalMs: 300,
          },
        ],
        total: {
          turnId: "t1",
          usage: { inputTokens: 80, outputTokens: 20 },
          durationMs: 500,
          steps: [
            {
              stepId: "t1#0" as StepId,
              usage: { inputTokens: 80, outputTokens: 20 },
              genTotalMs: 300,
            },
          ],
        },
      },
    ];

    render(ChatView, { props: { chunks, turnMetrics } });

    // Both step-metrics and turn-metrics render
    expect(screen.getByText(/step 1/)).toBeInTheDocument();
    expect(screen.getByText(/turn 1 · 100 tok/)).toBeInTheDocument();

    // They are in separate elements (different rows)
    const stepEl = screen.getByText(/step 1 · 100 tok/).closest("div");
    const turnEl = screen.getByText(/turn 1 · 100 tok/).closest("div");
    expect(stepEl).not.toBe(turnEl);
  });

  it("renders no metrics bubble when turnMetrics is empty", () => {
    const chunks: RenderedChunk[] = [
      { seq: 1, role: "user", chunk: { type: "text", text: "Hi" }, provisional: false },
      {
        seq: 2,
        role: "assistant",
        chunk: { type: "text", text: "Hello!" },
        provisional: false,
      },
    ];

    render(ChatView, { props: { chunks, turnMetrics: [] } });

    expect(screen.getByText("Hi")).toBeInTheDocument();
    expect(screen.getByText("Hello!")).toBeInTheDocument();
    expect(screen.queryByText(/step 1/)).toBeNull();
    expect(screen.queryByText(/^turn/)).toBeNull();
  });

  it("omits null view values from metrics bubbles", () => {
    const chunks: RenderedChunk[] = [
      { seq: 1, role: "user", chunk: { type: "text", text: "Test" }, provisional: false },
      {
        seq: 2,
        role: "assistant",
        chunk: { type: "text", text: "Response" },
        provisional: false,
      },
      {
        seq: 3,
        role: "assistant",
        chunk: {
          type: "tool-call",
          toolCallId: "tc1",
          toolName: "test",
          input: {},
          stepId: "t1#0" as StepId,
        },
        provisional: false,
      },
    ];

    const turnMetrics: TurnMetricsEntry[] = [
      {
        turnId: "t1",
        steps: [
          {
            stepId: "t1#0" as StepId,
            usage: { inputTokens: 10, outputTokens: 5 },
          },
        ],
        total: {
          turnId: "t1",
          usage: { inputTokens: 10, outputTokens: 5 },
          steps: [
            {
              stepId: "t1#0" as StepId,
              usage: { inputTokens: 10, outputTokens: 5 },
            },
          ],
        },
      },
    ];

    render(ChatView, { props: { chunks, turnMetrics } });

    // Step metrics rendered
    expect(screen.getByText(/step 1/)).toBeInTheDocument();
    expect(screen.getAllByText(/15 tok/)).toHaveLength(2);
    // Turn metrics rendered
    expect(screen.getByText(/turn 1 · 15 tok \(10 in \/ 5 out\)/)).toBeInTheDocument();
    // No "null" or "undefined" in the DOM
    expect(screen.queryByText("null")).toBeNull();
    expect(screen.queryByText("undefined")).toBeNull();
  });

  it("renders step text but no turn total for a progressive turn (total: null)", () => {
    const chunks: RenderedChunk[] = [
      { seq: 1, role: "user", chunk: { type: "text", text: "Hi" }, provisional: false },
      {
        seq: 2,
        role: "assistant",
        chunk: { type: "text", text: "Hello!" },
        provisional: false,
      },
      {
        seq: 3,
        role: "assistant",
        chunk: {
          type: "tool-call",
          toolCallId: "tc1",
          toolName: "test",
          input: {},
          stepId: "t1#0" as StepId,
        },
        provisional: false,
      },
    ];

    const turnMetrics: TurnMetricsEntry[] = [
      {
        turnId: "t1",
        steps: [
          {
            stepId: "t1#0" as StepId,
            usage: { inputTokens: 100, outputTokens: 50 },
            genTotalMs: 800,
          },
        ],
        total: null,
      },
    ];

    render(ChatView, { props: { chunks, turnMetrics } });

    // Step metrics should render
    expect(screen.getByText(/step 1/)).toBeInTheDocument();
    expect(screen.getByText(/150 tok/)).toBeInTheDocument();

    // Turn total should NOT render (total is null — turn still in progress)
    expect(screen.queryByText(/^turn/)).toBeNull();
  });

  it("renders a user image chunk as an <img> with the chunk's url", () => {
    const url = "data:image/png;base64,AAAA";
    const chunks: RenderedChunk[] = [
      {
        seq: 1,
        role: "user",
        chunk: { type: "image", url, mimeType: "image/png" },
        provisional: false,
      },
    ];

    const { container } = render(ChatView, { props: { chunks } });

    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe(url);
    expect(img?.getAttribute("alt")).toBe("image/png");
    expect(img?.getAttribute("loading")).toBe("lazy");
  });

  it("resolves a persisted image chunk's relative url against apiBaseUrl", () => {
    // Persisted image chunks now carry a compact relative path (`/images/…`)
    // served by the backend — prepend the API base to render them.
    const chunks: RenderedChunk[] = [
      {
        seq: 1,
        role: "user",
        chunk: { type: "image", url: "/images/conv-123/abc-456.png", mimeType: "image/png" },
        provisional: false,
      },
    ];

    const { container } = render(ChatView, {
      props: { chunks, apiBaseUrl: "http://localhost:24203" },
    });

    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "http://localhost:24203/images/conv-123/abc-456.png",
    );
  });

  it("passes a data URL through unchanged even with apiBaseUrl set (optimistic echo)", () => {
    // The optimistic echo (what the FE just sent) is still a data URL; it must
    // NOT be mangled by the base-URL prepend.
    const dataUrl = "data:image/png;base64,iVBOR=";
    const chunks: RenderedChunk[] = [
      { seq: null, role: "user", chunk: { type: "image", url: dataUrl }, provisional: true },
    ];

    const { container } = render(ChatView, {
      props: { chunks, apiBaseUrl: "http://localhost:24203" },
    });

    expect(container.querySelector("img")?.getAttribute("src")).toBe(dataUrl);
  });

  it("leaves a relative image url root-relative when apiBaseUrl is absent", () => {
    // No apiBaseUrl → a browser resolves `/images/…` against the document origin.
    const chunks: RenderedChunk[] = [
      {
        seq: 1,
        role: "user",
        chunk: { type: "image", url: "/images/conv-1/x.png" },
        provisional: false,
      },
    ];

    const { container } = render(ChatView, { props: { chunks } });

    expect(container.querySelector("img")?.getAttribute("src")).toBe("/images/conv-1/x.png");
  });

  it("renders a multi-chunk user message [text, image] and a transcription text", () => {
    // A non-vision model: the server persists the original image chunk AND a
    // transcription text chunk in the SAME user message — render both.
    const url = "data:image/png;base64,BBQ=";
    const chunks: RenderedChunk[] = [
      { seq: 1, role: "user", chunk: { type: "text", text: "describe this" }, provisional: false },
      {
        seq: 2,
        role: "user",
        chunk: { type: "image", url, mimeType: "image/png" },
        provisional: false,
      },
      {
        seq: 3,
        role: "user",
        chunk: { type: "text", text: "[Image analysis (via kimi/k2)]: a red square" },
        provisional: false,
      },
    ];

    const { container } = render(ChatView, { props: { chunks } });

    expect(screen.getByText("describe this")).toBeInTheDocument();
    expect(screen.getByText(/\[Image analysis/)).toBeInTheDocument();
    expect(container.querySelector("img")?.getAttribute("src")).toBe(url);
  });

  it("renders a consult_vision tool call/result like any other tool", () => {
    // read_image is GONE — replaced by consult_vision (opens a vision-model
    // conversation, attaches the image + question, returns the answer). It is
    // a normal tool call: rendered generically by toolName.
    const chunks: RenderedChunk[] = [
      {
        seq: 1,
        role: "assistant",
        chunk: {
          type: "tool-call",
          toolCallId: "tc1",
          toolName: "consult_vision",
          input: { question: "what is in this image?", imageIds: [1] },
        },
        provisional: false,
      },
      {
        seq: 2,
        role: "tool",
        chunk: {
          type: "tool-result",
          toolCallId: "tc1",
          toolName: "consult_vision",
          content: "a red square on a white background",
          isError: false,
        },
        provisional: false,
      },
    ];

    render(ChatView, { props: { chunks } });

    expect(screen.getAllByText("consult_vision").length).toBeGreaterThan(0);
    expect(screen.getByText("a red square on a white background")).toBeInTheDocument();
  });

  it("renders a non-vision placeholder text chunk as-is", () => {
    // A non-vision model gets a numbered placeholder (a regular text chunk)
    // instead of an auto-transcription. Renders like any text chunk.
    const chunks: RenderedChunk[] = [
      {
        seq: 1,
        role: "user",
        chunk: {
          type: "text",
          text: "[Image 1 attached — call consult_vision with imageIds=[1] and a specific question to analyze it]",
        },
        provisional: false,
      },
    ];

    render(ChatView, { props: { chunks } });

    expect(screen.getByText(/\[Image 1 attached/)).toBeInTheDocument();
    expect(screen.getByText(/consult_vision with imageIds/)).toBeInTheDocument();
  });

  it("renders a compacted-image text chunk as-is", () => {
    // Image compaction transcribes old images to [Compacted image]: <desc>.
    // Regular text chunk — render as-is.
    const chunks: RenderedChunk[] = [
      {
        seq: 1,
        role: "user",
        chunk: { type: "text", text: "[Compacted image]: a chart showing rising sales" },
        provisional: false,
      },
    ];

    render(ChatView, { props: { chunks } });

    expect(screen.getByText(/\[Compacted image\]/)).toBeInTheDocument();
    expect(screen.getByText(/rising sales/)).toBeInTheDocument();
  });
});

describe("Composer", () => {
  it("calls onSend with the typed text and clears", async () => {
    const onSend = vi.fn();
    const user = userEvent.setup();

    render(Composer, { props: { onSend } });

    const textarea = screen.getByRole("textbox", { name: "Message input" });
    await user.type(textarea, "Hello world");

    const sendButton = screen.getByRole("button", { name: "Send" });
    await user.click(sendButton);

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith("Hello world", undefined);
    expect(textarea).toHaveValue("");
  });

  it("does not call onSend with empty text", async () => {
    const onSend = vi.fn();
    const _user = userEvent.setup();

    render(Composer, { props: { onSend } });

    const sendButton = screen.getByRole("button", { name: "Send" });
    expect(sendButton).toBeDisabled();

    expect(onSend).not.toHaveBeenCalled();
  });

  it("trims whitespace before sending", async () => {
    const onSend = vi.fn();
    const user = userEvent.setup();

    render(Composer, { props: { onSend } });

    const textarea = screen.getByRole("textbox", { name: "Message input" });
    await user.type(textarea, "   hello   ");

    const sendButton = screen.getByRole("button", { name: "Send" });
    await user.click(sendButton);

    expect(onSend).toHaveBeenCalledWith("hello", undefined);
  });

  it("sends on Enter key (without Shift)", async () => {
    const onSend = vi.fn();
    const user = userEvent.setup();

    render(Composer, { props: { onSend } });

    const textarea = screen.getByRole("textbox", { name: "Message input" });
    await user.type(textarea, "Test message{Enter}");

    expect(onSend).toHaveBeenCalledWith("Test message", undefined);
  });

  it("does not send on Shift+Enter", async () => {
    const onSend = vi.fn();
    const user = userEvent.setup();

    render(Composer, { props: { onSend } });

    const textarea = screen.getByRole("textbox", { name: "Message input" });
    await user.type(textarea, "Line 1{Shift>}{Enter}{/Shift}Line 2");

    expect(onSend).not.toHaveBeenCalled();
  });

  it("stages a pasted image and forwards it on send", async () => {
    const onSend = vi.fn();
    const user = userEvent.setup();
    const { container } = render(Composer, { props: { onSend } });

    const textarea = screen.getByRole("textbox", { name: "Message input" });
    await user.type(textarea, "look at this");

    // jsdom has no ClipboardEvent/DataTransfer: dispatch a plain paste event
    // carrying a mock clipboardData whose only item is an image File.
    const file = new File(["PNG"], "shot.png", { type: "image/png" });
    const paste = new Event("paste", { bubbles: true });
    Object.defineProperty(paste, "clipboardData", {
      value: {
        items: [{ kind: "file", type: "image/png", getAsFile: () => file }],
      },
    });
    container.querySelector("textarea")?.dispatchEvent(paste);

    await vi.waitFor(() => {
      expect(screen.getByRole("button", { name: "Remove image" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(onSend).toHaveBeenCalledTimes(1);
    const [, images] = onSend.mock.calls[0] ?? [];
    expect(images).toHaveLength(1);
    expect(images[0]?.url).toMatch(/^data:image\/png;base64,/);
    expect(images[0]?.mimeType).toBe("image/png");
  });

  it("lets a text paste proceed when no image is on the clipboard", async () => {
    const onSend = vi.fn();
    const user = userEvent.setup();
    const { container } = render(Composer, { props: { onSend } });

    const textarea = screen.getByRole("textbox", { name: "Message input" });
    await user.type(textarea, "hello");

    // A text-only paste: no file items → the component must NOT preventDefault,
    // so the default text paste path is unaffected (no image staged).
    const paste = new Event("paste", { bubbles: true });
    Object.defineProperty(paste, "clipboardData", {
      value: { items: [{ kind: "string", type: "text/plain" }] },
    });
    container.querySelector("textarea")?.dispatchEvent(paste);

    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole("button", { name: "Remove image" })).not.toBeInTheDocument();
  });

  it("stages an image via the attach button's file picker", async () => {
    const onSend = vi.fn();
    const user = userEvent.setup();
    const { container } = render(Composer, { props: { onSend } });

    const file = new File(["JPG"], "photo.jpg", { type: "image/jpeg" });
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [file], writable: false });
    input.dispatchEvent(new Event("change", { bubbles: true }));

    await vi.waitFor(() => {
      expect(screen.getByRole("button", { name: "Remove image" })).toBeInTheDocument();
    });

    // Image-only send (no text): the Send button is enabled.
    const send = screen.getByRole("button", { name: "Send" });
    expect(send).not.toBeDisabled();
    await user.click(send);

    expect(onSend).toHaveBeenCalledTimes(1);
    const [text, images] = onSend.mock.calls[0] ?? [];
    expect(text).toBe("");
    expect(images).toHaveLength(1);
    expect(images[0]?.mimeType).toBe("image/jpeg");
  });

  it("removes a staged image via the remove button", async () => {
    const onSend = vi.fn();
    const user = userEvent.setup();
    const { container } = render(Composer, { props: { onSend } });

    const file = new File(["PNG"], "shot.png", { type: "image/png" });
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [file], writable: false });
    input.dispatchEvent(new Event("change", { bubbles: true }));

    await vi.waitFor(() => {
      expect(screen.getByRole("button", { name: "Remove image" })).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: "Remove image" }));

    expect(screen.queryByRole("button", { name: "Remove image" })).not.toBeInTheDocument();
    // With no text and no images, Send is disabled again.
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });

  it("ignores a non-image file chosen via the picker", async () => {
    const onSend = vi.fn();
    const { container } = render(Composer, { props: { onSend } });

    const file = new File(["TXT"], "notes.txt", { type: "text/plain" });
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [file], writable: false });
    input.dispatchEvent(new Event("change", { bubbles: true }));

    // Give the async staging a chance; a non-image is skipped.
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole("button", { name: "Remove image" })).not.toBeInTheDocument();
  });

  it("queues (steers) text-only and never forwards images", async () => {
    // While running, the Send button becomes "Queue"; steering is text-only.
    const onQueue = vi.fn();
    const onSend = vi.fn();
    const user = userEvent.setup();
    const { container } = render(Composer, { props: { onSend, onQueue, status: "running" } });

    const textarea = screen.getByRole("textbox", { name: "Message input" });
    await user.type(textarea, "steer here");

    // Also stage an image — it must NOT be forwarded on a queue.
    const file = new File(["PNG"], "shot.png", { type: "image/png" });
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [file], writable: false });
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.waitFor(() => {
      expect(screen.getByRole("button", { name: "Remove image" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Queue" }));
    expect(onQueue).toHaveBeenCalledWith("steer here");
    expect(onSend).not.toHaveBeenCalled();
  });
});

describe("ModelSelector", () => {
  const optionValues = (el: HTMLElement): string[] =>
    within(el)
      .getAllByRole("option")
      .map((o) => (o as HTMLOptionElement).value);

  it("renders a key selector (distinct keys) and a model selector (models for the current key)", () => {
    const models = ["openai/gpt-4", "openai/gpt-4o", "anthropic/claude-3", "google/gemini"];
    render(ModelSelector, {
      props: { models, selected: "anthropic/claude-3", onSelect: vi.fn() },
    });

    const keySelect = screen.getByRole("combobox", { name: "Key selector" });
    const modelSelect = screen.getByRole("combobox", { name: "Model selector" });
    expect(keySelect).toHaveValue("anthropic");
    expect(modelSelect).toHaveValue("claude-3");

    expect(optionValues(keySelect)).toEqual(["openai", "anthropic", "google"]);
    // only the models under the selected key
    expect(optionValues(modelSelect)).toEqual(["claude-3"]);
  });

  it("selecting a key switches to the first model under it", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    const models = ["openai/gpt-4", "openai/gpt-4o", "anthropic/claude-3"];

    render(ModelSelector, {
      props: { models, selected: "openai/gpt-4o", onSelect },
    });

    await user.selectOptions(screen.getByRole("combobox", { name: "Key selector" }), "anthropic");

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("anthropic/claude-3");
  });

  it("selecting a model keeps the current key", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    const models = ["openai/gpt-4", "openai/gpt-4o"];

    render(ModelSelector, {
      props: { models, selected: "openai/gpt-4", onSelect },
    });

    await user.selectOptions(screen.getByRole("combobox", { name: "Model selector" }), "gpt-4o");

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("openai/gpt-4o");
  });

  it("marks vision-capable models in the model dropdown", () => {
    const models = ["kimi/k2", "kimi/k1.5"];
    const modelInfo = {
      "kimi/k2": { vision: true },
      "kimi/k1.5": { vision: false },
    };
    render(ModelSelector, {
      props: { models, selected: "kimi/k2", onSelect: vi.fn(), modelInfo },
    });

    const modelSelect = screen.getByRole("combobox", { name: "Model selector" });
    const options = within(modelSelect).getAllByRole("option");
    expect(options).toHaveLength(2);
    expect(options[0]?.textContent).toContain("vision");
    expect(options[1]?.textContent).not.toContain("vision");
  });

  it("shows the vision indicator when the selected model is vision-capable", () => {
    render(ModelSelector, {
      props: {
        models: ["kimi/k2"],
        selected: "kimi/k2",
        onSelect: vi.fn(),
        modelInfo: { "kimi/k2": { vision: true } },
      },
    });
    expect(screen.getByText(/sees images natively/)).toBeInTheDocument();
  });

  it("shows the vision-handoff hint when the selected model is non-vision", () => {
    render(ModelSelector, {
      props: {
        models: ["umans/glm-5.2"],
        selected: "umans/glm-5.2",
        onSelect: vi.fn(),
        modelInfo: { "umans/glm-5.2": { vision: false } },
      },
    });
    expect(screen.getByText(/auto-described/i)).toBeInTheDocument();
    expect(screen.queryByText(/sees images natively/)).not.toBeInTheDocument();
  });

  it("shows the handoff hint when modelInfo is absent", () => {
    render(ModelSelector, {
      props: { models: ["openai/gpt-4"], selected: "openai/gpt-4", onSelect: vi.fn() },
    });
    expect(screen.getByText(/auto-described/i)).toBeInTheDocument();
  });
});

describe("ReasoningEffortSelector", () => {
  it("renders null effort + null thinking (never set) as the default level, marked '(default)'", () => {
    render(ReasoningEffortSelector, {
      props: { persistedEffort: null, persistedThinking: null, save: vi.fn() },
    });

    const select = screen.getByRole("combobox", { name: "Reasoning effort" });
    expect(select).toHaveValue("high");
    expect(within(select).getByRole("option", { name: "high (default)" })).toBeInTheDocument();
    // "Off" first, then the five ladder levels.
    const options = within(select).getAllByRole("option");
    expect(options).toHaveLength(6);
    expect(options[0]).toHaveValue("off");
    expect(within(select).getByRole("option", { name: "Off" })).toBeInTheDocument();
  });

  it("renders a persisted level as selected when thinking is on", () => {
    render(ReasoningEffortSelector, {
      props: { persistedEffort: "xhigh", persistedThinking: null, save: vi.fn() },
    });

    expect(screen.getByRole("combobox", { name: "Reasoning effort" })).toHaveValue("xhigh");
  });

  it("renders 'off' as selected when thinking is disabled (effort level is preserved but hidden)", () => {
    // thinking off is a SEPARATE axis: even with a persisted effort level, the
    // selector shows "off" while thinking is disabled.
    render(ReasoningEffortSelector, {
      props: { persistedEffort: "xhigh", persistedThinking: false, save: vi.fn() },
    });

    expect(screen.getByRole("combobox", { name: "Reasoning effort" })).toHaveValue("off");
    // the level option is still present (restored on an off→on toggle)
    expect(
      within(screen.getByRole("combobox")).getByRole("option", { name: "xhigh" }),
    ).toBeInTheDocument();
  });

  it("selecting a level saves it via the injected port and confirms", async () => {
    const save = vi.fn(async (selection: "off" | "low" | "medium" | "high" | "xhigh" | "max") => ({
      ok: true as const,
      selection,
    }));
    const user = userEvent.setup();

    render(ReasoningEffortSelector, {
      props: { persistedEffort: null, persistedThinking: null, save },
    });

    await user.selectOptions(screen.getByRole("combobox", { name: "Reasoning effort" }), "max");

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("max");
    await vi.waitFor(() => {
      expect(screen.getByText(/applies from the next turn/i)).toBeInTheDocument();
    });
    expect(screen.getByRole("combobox", { name: "Reasoning effort" })).toHaveValue("max");
  });

  it("selecting 'off' saves the separate disable signal (not a level)", async () => {
    const save = vi.fn(async (selection: "off" | "low" | "medium" | "high" | "xhigh" | "max") => ({
      ok: true as const,
      selection,
    }));
    const user = userEvent.setup();

    render(ReasoningEffortSelector, {
      props: { persistedEffort: "high", persistedThinking: null, save },
    });

    await user.selectOptions(screen.getByRole("combobox", { name: "Reasoning effort" }), "off");

    expect(save).toHaveBeenCalledTimes(1);
    // "off" is the separate thinking-disable signal — NOT a zero-effort level.
    expect(save).toHaveBeenCalledWith("off");
    await vi.waitFor(() => {
      expect(screen.getByText(/applies from the next turn/i)).toBeInTheDocument();
    });
    expect(screen.getByRole("combobox", { name: "Reasoning effort" })).toHaveValue("off");
  });

  it("a failed save shows the error and reverts to the persisted selection", async () => {
    const save = vi.fn(async () => ({ ok: false as const, error: "nope" }));
    const user = userEvent.setup();

    render(ReasoningEffortSelector, {
      props: { persistedEffort: "low", persistedThinking: null, save },
    });

    await user.selectOptions(screen.getByRole("combobox", { name: "Reasoning effort" }), "max");

    await vi.waitFor(() => {
      expect(screen.getByText("nope")).toBeInTheDocument();
    });
    expect(screen.getByRole("combobox", { name: "Reasoning effort" })).toHaveValue("low");
  });

  it("disables the select while a save is in flight (no double-fire)", async () => {
    let resolveSave: ((r: { ok: true; selection: "max" }) => void) | undefined;
    const save = vi.fn(
      () =>
        new Promise<{ ok: true; selection: "max" }>((resolve) => {
          resolveSave = resolve;
        }),
    );
    const user = userEvent.setup();

    render(ReasoningEffortSelector, {
      props: { persistedEffort: null, persistedThinking: null, save },
    });

    await user.selectOptions(screen.getByRole("combobox", { name: "Reasoning effort" }), "max");

    expect(screen.getByRole("combobox", { name: "Reasoning effort" })).toBeDisabled();

    resolveSave?.({ ok: true, selection: "max" });
    await vi.waitFor(() => {
      expect(screen.getByRole("combobox", { name: "Reasoning effort" })).toBeEnabled();
    });
  });
});
