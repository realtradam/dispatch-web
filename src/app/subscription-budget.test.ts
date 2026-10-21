import { describe, expect, it } from "vitest";
import {
  liveConversationIds,
  MAX_CHAT_SUBSCRIPTIONS,
  MAX_SURFACE_SUBSCRIPTIONS,
} from "./subscription-budget";

describe("live subscription budget", () => {
  it("reserves the focused conversation even when hundreds of viewers exist", () => {
    const viewers = Array.from({ length: 339 }, (_, i) => `viewer-${i}`);
    const selected = liveConversationIds("focused", viewers);
    expect(selected.size).toBe(MAX_CHAT_SUBSCRIPTIONS);
    expect(selected.has("focused")).toBe(true);
    expect(selected.size + MAX_SURFACE_SUBSCRIPTIONS).toBeLessThanOrEqual(256);
  });
  it("deduplicates a modal viewing the focused chat and permits drafts", () => {
    expect([...liveConversationIds("same", ["same", "other"])]).toEqual(["same", "other"]);
    expect([...liveConversationIds(null, [])]).toEqual([]);
  });
});
