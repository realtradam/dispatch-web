import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PendingInput } from "../pending-inputs";
import { createChatStore } from "../store.svelte";
import {
  createFakeCache,
  createFakeHistorySync,
  createFakeMetricsSync,
  createFakeTransport,
} from "../test-helpers";
import PendingInputs from "./PendingInputs.svelte";

function input(requestId: string, type: "chat.send" | "chat.queue" = "chat.send"): PendingInput {
  return {
    request: {
      ...(type === "chat.send" ? { type, message: requestId } : { type, text: requestId }),
      conversationId: "c",
      requestId,
      images: [{ url: "data:image/png;base64,AAAA", mimeType: "image/png" }],
    },
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  const remaining = vi.getTimerCount();
  vi.useRealTimers();
  expect(remaining).toBe(0);
});

describe("pending input warning grace period", () => {
  it.each([
    "chat.send",
    "chat.queue",
  ] as const)("renders no %s recovery UI before 1000 ms, then keeps its content stable", async (type) => {
    const { container } = render(PendingInputs, {
      inputs: [input("saved message", type)],
      onDiscard: vi.fn(),
    });
    expect(container.children).toHaveLength(0);
    expect(container.textContent).toBe("");
    await vi.advanceTimersByTimeAsync(999);
    expect(container.children).toHaveLength(0);
    expect(container.textContent).toBe("");
    expect(screen.queryByRole("status")).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    const warning = screen.getByRole("status");
    expect(warning).toHaveTextContent("Delivery unconfirmed. Your input is saved on this device.");
    expect(warning).toHaveTextContent(
      "Check the conversation history before sending again to avoid a duplicate.",
    );
    expect(screen.getByRole("textbox", { name: "Saved message" })).toHaveValue("saved message");
    expect(screen.getByRole("img", { name: "Saved attachment" })).toHaveAttribute(
      "src",
      "data:image/png;base64,AAAA",
    );
    const content = warning.innerHTML;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(screen.getByRole("status")).toBe(warning);
    expect(warning.innerHTML).toBe(content);
  });

  it.each([
    "confirmation",
    "discard",
  ])("%s before the threshold cancels the timer and never flashes later", async (resolution) => {
    const transport = createFakeTransport();
    const save = vi.fn();
    const store = createChatStore({
      conversationId: "c",
      createRequestId: () => "first",
      transport: transport.impl,
      historySync: createFakeHistorySync().impl,
      metricsSync: createFakeMetricsSync().impl,
      cache: createFakeCache().impl,
      pendingInputStorage: { load: () => [], save },
    });
    try {
      store.send("first");
      // Saving and transmission stay immediate, independent of warning display.
      expect(save).toHaveBeenCalledExactlyOnceWith(store.pendingInputs);
      expect(transport.sent).toHaveLength(1);
      const { container, rerender } = render(PendingInputs, {
        inputs: store.pendingInputs,
        onDiscard: store.discardPendingInput,
      });
      await vi.advanceTimersByTimeAsync(999);
      if (resolution === "confirmation") {
        store.handleDelta({ type: "chat.accepted", conversationId: "c", requestId: "first" });
      } else {
        store.discardPendingInput("first");
      }
      expect(store.pendingInputs).toEqual([]);
      expect(save).toHaveBeenLastCalledWith([]);
      await rerender({ inputs: store.pendingInputs });
      expect(vi.getTimerCount()).toBe(0);
      expect(container.children).toHaveLength(0);
      expect(container.textContent).toBe("");
      await vi.advanceTimersByTimeAsync(10_000);
      expect(container.children).toHaveLength(0);
      expect(container.textContent).toBe("");
    } finally {
      store.dispose();
    }
  });

  it("hides an already visible warning immediately on confirmation", async () => {
    const { container, rerender } = render(PendingInputs, {
      inputs: [input("first")],
      onDiscard: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(screen.getByRole("status")).toBeInTheDocument();
    await rerender({ inputs: [] });
    expect(container.children).toHaveLength(0);
    expect(container.textContent).toBe("");
  });

  it("preserves the discard action and hides the saved copy without another delay", async () => {
    const onDiscard = vi.fn();
    const { container, rerender } = render(PendingInputs, {
      inputs: [input("first")],
      onDiscard,
    });
    await vi.advanceTimersByTimeAsync(1000);
    await fireEvent.click(screen.getByRole("button", { name: "Discard saved copy" }));
    expect(onDiscard).toHaveBeenCalledExactlyOnceWith("first");
    await rerender({ inputs: [] });
    expect(container.children).toHaveLength(0);
    expect(container.textContent).toBe("");
  });

  it("cancels all waiting timers on unmount", async () => {
    const { unmount } = render(PendingInputs, {
      inputs: [input("first"), input("second")],
      onDiscard: vi.fn(),
    });
    expect(vi.getTimerCount()).toBe(2);
    await vi.advanceTimersByTimeAsync(500);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("gives successive inputs independent delays without restarting existing rows", async () => {
    const first = input("first");
    const second = input("second");
    const { rerender } = render(PendingInputs, { inputs: [first], onDiscard: vi.fn() });
    await vi.advanceTimersByTimeAsync(600);
    await rerender({ inputs: [second, { ...first }], onDiscard: vi.fn() });
    await vi.advanceTimersByTimeAsync(399);
    expect(screen.queryByRole("status")).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    const warning = screen.getByRole("status");
    expect(screen.getByRole("textbox")).toHaveValue("first");
    await rerender({ inputs: [{ ...second }, { ...first }], onDiscard: vi.fn() });
    await vi.advanceTimersByTimeAsync(599);
    expect(screen.getAllByRole("status")).toEqual([warning]);
    await vi.advanceTimersByTimeAsync(1);
    expect(
      screen.getAllByRole("textbox").map((node) => (node as HTMLTextAreaElement).value),
    ).toEqual(["second", "first"]);
    // Removing the older warning must not re-hide/restart the newer warning.
    await rerender({ inputs: [second] });
    expect(screen.getByRole("textbox")).toHaveValue("second");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("starts a fresh delay after an earlier input was confirmed during its grace period", async () => {
    const { rerender } = render(PendingInputs, { inputs: [input("first")], onDiscard: vi.fn() });
    await vi.advanceTimersByTimeAsync(600);
    await rerender({ inputs: [] });
    await rerender({ inputs: [input("second")] });
    await vi.advanceTimersByTimeAsync(999);
    expect(screen.queryByRole("status")).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(screen.getByRole("textbox")).toHaveValue("second");
  });

  it("keeps the original deadline when rejection arrives, and updates visible content immediately", async () => {
    const pending = input("first");
    const { rerender } = render(PendingInputs, { inputs: [pending], onDiscard: vi.fn() });
    await vi.advanceTimersByTimeAsync(600);
    await rerender({ inputs: [{ ...pending, rejection: "disk full" }] });
    await vi.advanceTimersByTimeAsync(399);
    expect(screen.queryByRole("status")).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    const warning = screen.getByRole("status");
    expect(warning).toHaveTextContent("Message rejected: disk full");
    expect(warning).not.toHaveTextContent("Delivery unconfirmed");
    await rerender({ inputs: [{ ...pending, rejection: "still rejected" }] });
    expect(screen.getByRole("status")).toBe(warning);
    expect(warning).toHaveTextContent("Message rejected: still rejected");
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    undefined,
    "disk full",
  ])("restored entries (rejection: %s) use the same grace period and retain recovery content", async (rejection) => {
    const restored = input("restored saved message");
    render(PendingInputs, {
      inputs: [rejection === undefined ? restored : { ...restored, rejection }],
      onDiscard: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(999);
    expect(screen.queryByRole("status")).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(screen.getByRole("status")).toHaveTextContent(
      rejection === undefined ? "Delivery unconfirmed" : "Message rejected: disk full",
    );
    expect(screen.getByRole("textbox")).toHaveValue("restored saved message");
    expect(screen.getByRole("button", { name: "Discard saved copy" })).toBeEnabled();
  });
});
