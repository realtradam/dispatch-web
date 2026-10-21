import { describe, expect, it } from "vitest";
import { appendUserMessage, applyHistory, foldEvent, initialState, removeLocalEcho } from "./index";

describe("request-local optimistic echo", () => {
  it("retains identity through turn-start tags without conflating identical sends", () => {
    let state = appendUserMessage(initialState(), "same", [{ url: "data:first" }], "r1");
    state = appendUserMessage(state, "same", [{ url: "data:second" }], "r2");
    state = foldEvent(state, { type: "turn-start", conversationId: "c1", turnId: "t1" });
    state = removeLocalEcho(state, "r1");
    expect(state.provisional.map((p) => p.localRequestId)).toEqual(["r2", "r2"]);
    expect(state.provisional.map((p) => p.chunk)).toEqual([
      { type: "text", text: "same" },
      { type: "image", url: "data:second" },
    ]);
    expect(state.generating).toBe(true);
    expect(removeLocalEcho(state, "r1")).toBe(state);
  });

  it("a live user-message confirms only its deduplicated text, not every identical local send", () => {
    let state = appendUserMessage(initialState(), "same", [{ url: "data:first" }], "r1");
    state = appendUserMessage(state, "same", [{ url: "data:second" }], "r2");
    state = foldEvent(state, { type: "turn-start", conversationId: "c1", turnId: "t1" });
    state = foldEvent(state, {
      type: "user-message",
      conversationId: "c1",
      turnId: "t1",
      text: "same",
    });
    state = removeLocalEcho(removeLocalEcho(state, "r1"), "r2");
    expect(state.provisional).toEqual([
      { role: "user", turnId: "t1", chunk: { type: "text", text: "same" } },
    ]);
  });

  it("does not remove committed rows even if their content is identical", () => {
    let state = appendUserMessage(initialState(), "same", undefined, "r1");
    state = applyHistory(state, [{ seq: 1, role: "user", chunk: { type: "text", text: "same" } }]);
    const committed = state.committed;
    state = removeLocalEcho(state, "r1");
    expect(state.committed).toBe(committed);
    expect(state.provisional).toEqual([]);
    expect(removeLocalEcho(state, "r1")).toBe(state);
    expect(removeLocalEcho(initialState(), "r1")).toEqual(initialState());
  });
});
