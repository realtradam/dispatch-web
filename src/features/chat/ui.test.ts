import type { StepId } from "@dispatch/wire";
import { render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { RenderedChunk } from "../../core/chunks";
import type { TurnMetricsEntry } from "../../core/metrics";
import ChatView from "./ui/ChatView.svelte";
import Composer from "./ui/Composer.svelte";
import ModelSelector from "./ui/ModelSelector.svelte";

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

		// One DaisyUI list with two rows (one per call), not separate cards.
		const lists = container.querySelectorAll("ul.list");
		expect(lists).toHaveLength(1);
		expect(container.querySelectorAll("ul.list > li.list-row")).toHaveLength(2);

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
		expect(screen.getByText(/turn · 150 tok \(100 in \/ 50 out\)/)).toBeInTheDocument();
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
		expect(screen.getByText(/turn · 100 tok/)).toBeInTheDocument();

		// They are in separate elements (different rows)
		const stepEl = screen.getByText(/step 1 · 100 tok/).closest("div");
		const turnEl = screen.getByText(/turn · 100 tok/).closest("div");
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
		expect(screen.getByText(/turn · 15 tok \(10 in \/ 5 out\)/)).toBeInTheDocument();
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
		expect(onSend).toHaveBeenCalledWith("Hello world");
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

		expect(onSend).toHaveBeenCalledWith("hello");
	});

	it("sends on Enter key (without Shift)", async () => {
		const onSend = vi.fn();
		const user = userEvent.setup();

		render(Composer, { props: { onSend } });

		const textarea = screen.getByRole("textbox", { name: "Message input" });
		await user.type(textarea, "Test message{Enter}");

		expect(onSend).toHaveBeenCalledWith("Test message");
	});

	it("does not send on Shift+Enter", async () => {
		const onSend = vi.fn();
		const user = userEvent.setup();

		render(Composer, { props: { onSend } });

		const textarea = screen.getByRole("textbox", { name: "Message input" });
		await user.type(textarea, "Line 1{Shift>}{Enter}{/Shift}Line 2");

		expect(onSend).not.toHaveBeenCalled();
	});
});

describe("ModelSelector", () => {
	it("renders the options and current selection", () => {
		const models = ["openai/gpt-4", "anthropic/claude-3", "google/gemini"];
		render(ModelSelector, {
			props: { models, selected: "anthropic/claude-3", onSelect: vi.fn() },
		});

		const select = screen.getByRole("combobox", { name: "Model selector" });
		expect(select).toBeInTheDocument();
		expect(select).toHaveValue("anthropic/claude-3");

		const options = screen.getAllByRole("option");
		expect(options).toHaveLength(3);
		expect(options[0]).toHaveValue("openai/gpt-4");
		expect(options[1]).toHaveValue("anthropic/claude-3");
		expect(options[2]).toHaveValue("google/gemini");
	});

	it("calls onSelect on change", async () => {
		const onSelect = vi.fn();
		const user = userEvent.setup();
		const models = ["openai/gpt-4", "anthropic/claude-3"];

		render(ModelSelector, {
			props: { models, selected: "openai/gpt-4", onSelect },
		});

		const select = screen.getByRole("combobox", { name: "Model selector" });
		await user.selectOptions(select, "anthropic/claude-3");

		expect(onSelect).toHaveBeenCalledTimes(1);
		expect(onSelect).toHaveBeenCalledWith("anthropic/claude-3");
	});
});
