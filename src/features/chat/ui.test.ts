import type { StepId } from "@dispatch/wire";
import { render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { RenderedChunk } from "../../core/chunks";
import type { TelemetryState } from "../../core/telemetry";
import { initialState } from "../../core/telemetry";
import ChatView from "./ui/ChatView.svelte";
import Composer from "./ui/Composer.svelte";
import ModelSelector from "./ui/ModelSelector.svelte";
import TurnSummary from "./ui/TurnSummary.svelte";

const emptyTelemetry = initialState();
const noTurnId = null;

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

		render(ChatView, { props: { chunks, telemetry: emptyTelemetry, currentTurnId: noTurnId } });

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

		render(ChatView, { props: { chunks, telemetry: emptyTelemetry, currentTurnId: noTurnId } });

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

		render(ChatView, { props: { chunks, telemetry: emptyTelemetry, currentTurnId: noTurnId } });

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

		render(ChatView, { props: { chunks, telemetry: emptyTelemetry, currentTurnId: noTurnId } });

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

		render(ChatView, { props: { chunks, telemetry: emptyTelemetry, currentTurnId: noTurnId } });

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

		render(ChatView, { props: { chunks, telemetry: emptyTelemetry, currentTurnId: noTurnId } });

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

		render(ChatView, { props: { chunks, telemetry: emptyTelemetry, currentTurnId: noTurnId } });

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

		render(ChatView, { props: { chunks, telemetry: emptyTelemetry, currentTurnId: noTurnId } });

		// In-flight chunks render at full opacity (no faded "disabled" look).
		const wrapper = screen.getByText("Streaming...").closest("div");
		expect(wrapper).not.toHaveClass("opacity-50");
	});

	it("renders empty transcript", () => {
		render(ChatView, { props: { chunks: [], telemetry: emptyTelemetry, currentTurnId: noTurnId } });

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

		const { container } = render(ChatView, {
			props: { chunks, telemetry: emptyTelemetry, currentTurnId: noTurnId },
		});

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

		const { container } = render(ChatView, {
			props: { chunks, telemetry: emptyTelemetry, currentTurnId: noTurnId },
		});

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

		const { container, rerender } = render(ChatView, {
			props: { chunks: streaming, telemetry: emptyTelemetry, currentTurnId: noTurnId },
		});

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
			telemetry: emptyTelemetry,
			currentTurnId: noTurnId,
		});

		// Completed: "Thoughts", no dots — and the open state survived the transition.
		expect(screen.getByText("Thoughts")).toBeInTheDocument();
		expect(screen.queryByText("Thinking")).toBeNull();
		expect(container.querySelector(".loading")).toBeNull();
		expect(screen.getByRole("checkbox", { name: "Toggle thoughts" })).toBeChecked();
		expect(container).toHaveTextContent("hmm, all done");
	});

	it("assistant text shows step metrics footer when step-complete data is available", () => {
		const chunks: RenderedChunk[] = [
			{
				seq: 1,
				role: "assistant",
				chunk: { type: "text", text: "Here is my answer" },
				provisional: false,
			},
		];

		const telemetry: TelemetryState = {
			turns: new Map([
				[
					"turn-1",
					{
						wallMs: 2500,
						steps: [
							{
								stepId: "turn-1#0" as StepId,
								genTotalMs: 1200,
								decodeMs: 1000,
								usage: { inputTokens: 100, outputTokens: 86 },
							},
						],
					},
				],
			]),
		};

		render(ChatView, { props: { chunks, telemetry, currentTurnId: "turn-1" } });

		expect(screen.getByText("Here is my answer")).toBeInTheDocument();
		expect(screen.getByText("1.2s")).toBeInTheDocument();
		expect(screen.getByText("86 t/s")).toBeInTheDocument();
		expect(screen.getByText("86 tok")).toBeInTheDocument();
	});

	it("does not show metrics footer when no step data exists", () => {
		const chunks: RenderedChunk[] = [
			{
				seq: 1,
				role: "assistant",
				chunk: { type: "text", text: "Still streaming" },
				provisional: true,
			},
		];

		render(ChatView, { props: { chunks, telemetry: emptyTelemetry, currentTurnId: "turn-1" } });

		expect(screen.getByText("Still streaming")).toBeInTheDocument();
		expect(screen.queryByText("t/s")).toBeNull();
		expect(screen.queryByText("tok")).toBeNull();
	});
});

describe("TurnSummary", () => {
	it("renders turn stats when telemetry has data", () => {
		const telemetry: TelemetryState = {
			turns: new Map([
				[
					"turn-1",
					{
						wallMs: 4200,
						steps: [
							{
								stepId: "turn-1#0" as StepId,
								genTotalMs: 2000,
								decodeMs: 1500,
								usage: { inputTokens: 500, outputTokens: 300 },
							},
							{
								stepId: "turn-1#1" as StepId,
								genTotalMs: 1800,
								decodeMs: 1200,
								usage: { inputTokens: 600, outputTokens: 200 },
							},
						],
					},
				],
			]),
		};

		render(TurnSummary, { props: { telemetry, turnId: "turn-1" } });

		expect(screen.getByText("Turn")).toBeInTheDocument();
		expect(screen.getByText("4.2s")).toBeInTheDocument();
		expect(screen.getByText("Tokens")).toBeInTheDocument();
		expect(screen.getByText("1,600")).toBeInTheDocument();
		expect(screen.getByText("Output")).toBeInTheDocument();
		expect(screen.getByText("500")).toBeInTheDocument();
		expect(screen.getByText("Input")).toBeInTheDocument();
		expect(screen.getByText("1,100")).toBeInTheDocument();
		expect(screen.getByText("Steps")).toBeInTheDocument();
		expect(screen.getByText("2")).toBeInTheDocument();
		expect(screen.getByText("TPS")).toBeInTheDocument();
		expect(screen.getByText("185 t/s")).toBeInTheDocument();
	});

	it("renders nothing when turnId is null", () => {
		const { container } = render(TurnSummary, {
			props: { telemetry: emptyTelemetry, turnId: null },
		});
		expect(container.querySelector(".stats")).toBeNull();
	});

	it("renders nothing when turn metrics not found", () => {
		const { container } = render(TurnSummary, {
			props: { telemetry: emptyTelemetry, turnId: "nonexistent" },
		});
		expect(container.querySelector(".stats")).toBeNull();
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
