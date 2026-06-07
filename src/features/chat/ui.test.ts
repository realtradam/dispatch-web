import { render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { RenderedChunk } from "../../core/chunks";
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

	it("marks provisional chunks", () => {
		const chunks: RenderedChunk[] = [
			{
				seq: null,
				role: "assistant",
				chunk: { type: "text", text: "Streaming..." },
				provisional: true,
			},
		];

		render(ChatView, { props: { chunks } });

		// Assistant chunks are no longer in a bubble; the provisional marker now
		// lives on the plain wrapper that directly contains the text.
		const wrapper = screen.getByText("Streaming...").closest("div");
		expect(wrapper).toHaveClass("opacity-50");
	});

	it("renders empty transcript", () => {
		render(ChatView, { props: { chunks: [] } });

		const log = screen.getByRole("log");
		expect(log).toBeInTheDocument();
		expect(log.children).toHaveLength(0);
	});

	it("thinking <details> stays open across a streaming update", async () => {
		const initial: RenderedChunk[] = [
			{
				seq: null,
				role: "assistant",
				chunk: { type: "thinking", text: "Let me think..." },
				provisional: true,
			},
		];

		const { rerender } = render(ChatView, { props: { chunks: initial } });

		const details = screen.getByText("Thinking").closest("details");
		expect(details).not.toBeNull();
		expect(details).not.toHaveAttribute("open");
		if (details) details.open = true;
		expect(details).toHaveAttribute("open");

		const updated: RenderedChunk[] = [
			{
				seq: null,
				role: "assistant",
				chunk: { type: "thinking", text: "Let me think... step by step" },
				provisional: true,
			},
		];
		await rerender({ chunks: updated });

		const detailsAfter = screen.getByText("Thinking").closest("details");
		expect(detailsAfter).not.toBeNull();
		expect(detailsAfter).toHaveAttribute("open");
		expect(detailsAfter).toHaveTextContent("Let me think... step by step");
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
