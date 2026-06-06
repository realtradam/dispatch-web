import { render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { RenderedChunk } from "../../core/chunks";
import ChatView from "./ui/ChatView.svelte";
import Composer from "./ui/Composer.svelte";

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
		expect(screen.getByText("assistant")).toBeInTheDocument();
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

		const article = screen.getByText("Streaming...").closest("article");
		expect(article).toHaveClass("message--provisional");
	});

	it("renders empty transcript", () => {
		render(ChatView, { props: { chunks: [] } });

		const log = screen.getByRole("log");
		expect(log).toBeInTheDocument();
		expect(log.children).toHaveLength(0);
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
