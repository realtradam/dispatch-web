import { render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { createRawSnippet } from "svelte";
import { describe, expect, it } from "vitest";
import ViewSidebar from "./ViewSidebar.svelte";

const kinds = [
	{ id: "surfaces", label: "Surfaces" },
	{ id: "tasks", label: "Tasks" },
];

// A raw snippet that echoes the kind it was rendered for, so tests can assert
// which view-kind content each panel shows.
const content = createRawSnippet<[string]>((kind) => ({
	render: () => `<div data-testid="view-content">kind:${kind()}</div>`,
}));

describe("ViewSidebar", () => {
	it("opens one panel seeded with the first kind and renders its content", () => {
		render(ViewSidebar, { props: { kinds, content } });
		expect(screen.getAllByRole("combobox")).toHaveLength(1);
		expect(screen.getByTestId("view-content")).toHaveTextContent("kind:surfaces");
	});

	it("the first panel has no remove button", () => {
		render(ViewSidebar, { props: { kinds, content } });
		expect(screen.queryByRole("button", { name: "Remove view" })).toBeNull();
	});

	it("the add button appends a new empty panel", async () => {
		const user = userEvent.setup();
		render(ViewSidebar, { props: { kinds, content } });
		await user.click(screen.getByRole("button", { name: "Add view" }));
		expect(screen.getAllByRole("combobox")).toHaveLength(2);
		// the new panel is empty → only the first panel renders content
		expect(screen.getAllByTestId("view-content")).toHaveLength(1);
	});

	it("non-first panels can be removed", async () => {
		const user = userEvent.setup();
		render(ViewSidebar, { props: { kinds, content } });
		await user.click(screen.getByRole("button", { name: "Add view" }));
		const removeButtons = screen.getAllByRole("button", { name: "Remove view" });
		expect(removeButtons).toHaveLength(1);
		const target = removeButtons[0];
		if (target === undefined) throw new Error("expected a remove button");
		await user.click(target);
		expect(screen.getAllByRole("combobox")).toHaveLength(1);
	});

	it("selecting a kind renders that kind's content", async () => {
		const user = userEvent.setup();
		render(ViewSidebar, { props: { kinds, content, initial: [null] } });
		expect(screen.queryByTestId("view-content")).toBeNull();
		await user.selectOptions(screen.getByRole("combobox"), "tasks");
		expect(screen.getByTestId("view-content")).toHaveTextContent("kind:tasks");
	});
});
