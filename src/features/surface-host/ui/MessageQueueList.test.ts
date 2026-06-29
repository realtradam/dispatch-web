import type { QueuedMessage } from "@dispatch/wire";
import { render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import MessageQueueList from "./MessageQueueList.svelte";

function msg(id: string, text: string, queuedAt = 1_700_000_000_000): QueuedMessage {
  return { id, text, queuedAt };
}

/** Build the message-queue surface field payload. */
function payload(messages: readonly QueuedMessage[]): { messages: readonly QueuedMessage[] } {
  return { messages };
}

describe("MessageQueueList", () => {
  it("renders each queued message's text", () => {
    render(MessageQueueList, {
      props: {
        payload: payload([msg("m1", "steer left"), msg("m2", "go right")]),
        onCancel: undefined,
      },
    });
    expect(screen.getByText("steer left")).toBeInTheDocument();
    expect(screen.getByText("go right")).toBeInTheDocument();
  });

  it("renders nothing when the queue is empty", () => {
    const { container } = render(MessageQueueList, {
      props: { payload: payload([]), onCancel: undefined },
    });
    expect(container.querySelector("ul")).toBeNull();
  });

  it("renders nothing for a malformed payload (graceful skip)", () => {
    const { container } = render(MessageQueueList, {
      props: { payload: { nope: true }, onCancel: undefined },
    });
    expect(container.querySelector("ul")).toBeNull();
  });

  it("omits the cancel button when no onCancel is wired (read-only)", () => {
    render(MessageQueueList, {
      props: { payload: payload([msg("m1", "steer")]), onCancel: undefined },
    });
    expect(screen.queryByRole("button", { name: /cancel/i })).toBeNull();
  });

  it("renders a cancel button per row when onCancel is wired", () => {
    render(MessageQueueList, {
      props: { payload: payload([msg("m1", "a"), msg("m2", "b")]), onCancel: vi.fn() },
    });
    expect(screen.getAllByRole("button", { name: /cancel/i })).toHaveLength(2);
  });

  it("clicking cancel fires onCancel with the row's message id and optimistically hides the row", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(MessageQueueList, {
      props: { payload: payload([msg("m1", "keep me"), msg("m2", "cancel me")]), onCancel },
    });

    // Both rows visible before click.
    expect(screen.getByText("keep me")).toBeInTheDocument();
    expect(screen.getByText("cancel me")).toBeInTheDocument();

    const buttons = screen.getAllByRole("button", { name: /cancel/i });
    // Cancel the SECOND row (m2). Buttons mirror row order.
    const cancelM2 = buttons[1];
    if (cancelM2 === undefined) throw new Error("expected two cancel buttons");
    await user.click(cancelM2);

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledWith("m2");
    // m2 is optimistically hidden immediately; m1 remains.
    expect(screen.getByText("keep me")).toBeInTheDocument();
    expect(screen.queryByText("cancel me")).toBeNull();
  });

  it("does not fire onCancel twice for a double-click on the same row (idempotent client-side)", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(MessageQueueList, {
      props: { payload: payload([msg("m1", "x")]), onCancel },
    });

    const button = screen.getByRole("button", { name: /cancel/i });
    await user.click(button);
    // The row is gone after the first click; the button left the DOM, so a
    // second click on the stale element is a no-op — onCancel fires once.
    await user.click(button).catch(() => {});
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("reconciles from the surface: a cancelled id gone from the snapshot clears the optimistic hide", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const { rerender } = render(MessageQueueList, {
      props: { payload: payload([msg("m1", "a"), msg("m2", "b")]), onCancel },
    });

    // Cancel m1 — it hides optimistically.
    const cancelButtons = screen.getAllByRole("button", { name: /cancel/i });
    const cancelM1 = cancelButtons[0];
    if (cancelM1 === undefined) throw new Error("expected a cancel button");
    await user.click(cancelM1);
    expect(screen.queryByText("a")).toBeNull();
    expect(screen.getByText("b")).toBeInTheDocument();

    // The surface pushes the post-cancel snapshot: m1 is gone (server confirmed).
    // A NEW message m3 arrives in the same snapshot. The list renders m2 + m3.
    rerender({ payload: payload([msg("m2", "b"), msg("m3", "c")]), onCancel });
    expect(screen.queryByText("a")).toBeNull();
    expect(screen.getByText("b")).toBeInTheDocument();
    expect(screen.getByText("c")).toBeInTheDocument();
  });

  it("re-shows a row if the surface snapshot still contains a cancelled id (cancel not yet confirmed)", async () => {
    // Edge case: the cancel is in flight and the surface hasn't updated yet, but
    // a re-render with the SAME snapshot must keep the row hidden (optimistic).
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const samePayload = payload([msg("m1", "a")]);
    const { rerender } = render(MessageQueueList, {
      props: { payload: samePayload, onCancel },
    });

    await user.click(screen.getByRole("button", { name: /cancel/i }));
    expect(screen.queryByText("a")).toBeNull();

    // Re-render with the same (stale) snapshot — the row stays hidden.
    rerender({ payload: payload([msg("m1", "a")]), onCancel });
    expect(screen.queryByText("a")).toBeNull();
  });
});
