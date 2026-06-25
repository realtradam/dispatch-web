import { render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { ChatLimitSaveResult } from "../logic/view-model";
import ChatLimitField from "./ChatLimitField.svelte";

// A fake save that resolves ok with the value it was given.
function fakeSave(): {
	saves: number[];
	last: number | null;
	impl: (value: number) => Promise<ChatLimitSaveResult>;
} {
	const saves: number[] = [];
	return {
		saves,
		last: null,
		impl: async (value: number) => {
			saves.push(value);
			return { ok: true, chatLimit: value };
		},
	};
}

describe("ChatLimitField", () => {
	it("seeds the input from the persisted limit and disables Set while unchanged", () => {
		render(ChatLimitField, { props: { chatLimit: 256, save: fakeSave().impl } });
		expect(screen.getByLabelText("Chat limit")).toHaveValue("256");
		expect(screen.getByRole("button", { name: "Set" })).toBeDisabled();
	});

	it("enables Set when the typed value differs (regression: number-binding coercion)", async () => {
		const user = userEvent.setup();
		const save = fakeSave();
		render(ChatLimitField, { props: { chatLimit: 256, save: save.impl } });

		const input = screen.getByLabelText("Chat limit");
		await user.clear(input);
		await user.type(input, "10");

		expect(screen.getByRole("button", { name: "Set" })).toBeEnabled();
	});

	it("keeps Set disabled for non-numeric input", async () => {
		const user = userEvent.setup();
		const save = fakeSave();
		render(ChatLimitField, { props: { chatLimit: 256, save: save.impl } });

		const input = screen.getByLabelText("Chat limit");
		await user.clear(input);
		await user.type(input, "abc");

		expect(screen.getByRole("button", { name: "Set" })).toBeDisabled();
	});

	it("clicking Set calls save with the parsed value and shows the confirmation", async () => {
		const user = userEvent.setup();
		const save = fakeSave();
		const { rerender } = render(ChatLimitField, {
			props: { chatLimit: 256, save: save.impl },
		});

		const input = screen.getByLabelText("Chat limit");
		await user.clear(input);
		await user.type(input, "50");
		await user.click(screen.getByRole("button", { name: "Set" }));

		expect(save.saves).toEqual([50]);
		// In the real app the reactive `chatLimit` prop updates to the saved value
		// (the store sets it synchronously), which clears `dirty` and reveals the
		// "Saved" badge. Rerender simulates that propagation.
		rerender({ chatLimit: 50, save: save.impl });
		expect(screen.getByText(/Saved/i)).toBeInTheDocument();
	});

	it("clamps a below-floor value when saving", async () => {
		const user = userEvent.setup();
		const save = fakeSave();
		render(ChatLimitField, { props: { chatLimit: 256, save: save.impl } });

		const input = screen.getByLabelText("Chat limit");
		await user.clear(input);
		await user.type(input, "5"); // clamps to MIN (10)
		await user.click(screen.getByRole("button", { name: "Set" }));

		// The save port receives the clamped value (the view-model clamps before save).
		expect(save.saves).toEqual([10]);
		expect(input).toHaveValue("10");
	});
});
