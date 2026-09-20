import { render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import HomeHeader from "./HomeHeader.svelte";

function props() {
  return {
    onCreate: vi.fn(async (_slug: string): Promise<{ ok: true }> => ({ ok: true })),
    onOpenPlugins: vi.fn(),
    onSort: vi.fn(),
    onOpenArchived: vi.fn(),
  };
}

describe("HomeHeader", () => {
  it("renders the display title and the primary New workspace button", () => {
    const p = props();
    render(HomeHeader, { props: p });
    expect(screen.getByRole("heading", { name: "Dispatch" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New workspace" })).toBeInTheDocument();
  });

  it("the Plugins button renders only with the plugins port", () => {
    const p = props();
    const without = render(HomeHeader, { props: p });
    expect(without.queryByRole("button", { name: "Plugins" })).toBeNull();
    without.unmount();

    render(HomeHeader, { props: { ...p, withPlugins: true } });
    screen.getByRole("button", { name: "Plugins" }).click();
    expect(p.onOpenPlugins).toHaveBeenCalledTimes(1);
  });

  it("the Sort overflow renders only when asked, and dispatches", async () => {
    const user = userEvent.setup();
    const p = props();
    render(HomeHeader, { props: { ...p, withSort: true } });

    await user.click(screen.getByRole("button", { name: "More actions" }));
    await user.click(screen.getByRole("button", { name: "Reset arrangement by recent activity" }));
    expect(p.onSort).toHaveBeenCalledTimes(1);
  });

  it("the Create button disables for an invalid slug (validation before submit)", async () => {
    const user = userEvent.setup();
    const p = props();
    render(HomeHeader, { props: p });

    await user.click(screen.getByRole("button", { name: "New workspace" }));
    const input = screen.getByRole("textbox", { name: "New workspace" });
    await user.type(input, "Invalid Slug!");
    expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();
    expect(p.onCreate).not.toHaveBeenCalled();

    // A valid slug enables it.
    await user.clear(input);
    await user.type(input, "my-workspace");
    expect(screen.getByRole("button", { name: "Create" })).toBeEnabled();
  });

  it("submitting the form with Enter creates via the callback and closes the popover", async () => {
    const user = userEvent.setup();
    const p = props();
    render(HomeHeader, { props: p });

    await user.click(screen.getByRole("button", { name: "New workspace" }));
    await user.type(screen.getByRole("textbox", { name: "New workspace" }), "my-workspace{Enter}");

    expect(p.onCreate).toHaveBeenCalledWith("my-workspace");
  });

  it("a backend error keeps the form open with the message", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn(
      async (): Promise<{ ok: false; error: string }> => ({ ok: false, error: "taken" }),
    );
    render(HomeHeader, { props: { ...props(), onCreate } });

    await user.click(screen.getByRole("button", { name: "New workspace" }));
    await user.type(screen.getByRole("textbox", { name: "New workspace" }), "my-workspace");
    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(await screen.findByText("taken")).toBeInTheDocument();
  });

  it("compact mode collapses the primary button to an icon", () => {
    const p = props();
    render(HomeHeader, { props: { ...p, compact: true } });
    expect(screen.getByRole("button", { name: "New workspace" })).toHaveTextContent("+");
  });
});
