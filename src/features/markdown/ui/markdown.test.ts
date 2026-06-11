import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import Markdown from "./Markdown.svelte";

describe("Markdown", () => {
	it("renders markdown into a .markdown-body container", () => {
		const { container } = render(Markdown, { props: { text: "# Hello\n\n**hi**" } });

		expect(container.querySelector(".markdown-body")).not.toBeNull();
		expect(screen.getByRole("heading", { level: 1, name: "Hello" })).toBeInTheDocument();
		expect(container.querySelector("strong")?.textContent).toBe("hi");
	});

	it("strips dangerous markup", () => {
		const { container } = render(Markdown, {
			props: { text: "before <script>alert(1)</script> after" },
		});

		expect(container.querySelector("script")).toBeNull();
		expect(container.textContent).toContain("before");
	});

	it("renders a copy button on a code block that copies the code to the clipboard", async () => {
		const writeText = vi.fn().mockResolvedValue(undefined);
		Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

		const { container } = render(Markdown, {
			props: { text: "```js\nconst x = 1;\n```" },
		});

		const button = container.querySelector<HTMLElement>("[data-copy]");
		expect(button).not.toBeNull();
		if (button === null) throw new Error("expected a copy button");

		await fireEvent.click(button);

		expect(writeText).toHaveBeenCalledTimes(1);
		expect(writeText.mock.calls[0]?.[0]).toContain("const x = 1;");
	});
});
