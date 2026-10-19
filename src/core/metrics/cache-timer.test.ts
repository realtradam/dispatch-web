import type { AgentEvent, StepId, TurnMetrics } from "@dispatch/wire";
import { describe, expect, it } from "vitest";
import type { RenderGroup } from "../chunks";
import {
  CACHE_TIMER_MAX_MS,
  CACHE_TTL_MS,
  type CacheTimerState,
  foldCacheTimerEvent,
  initialCacheTimerState,
  lastTurnRowIndex,
  seedTurnGap,
  stopTurnGap,
  viewCacheTimer,
} from "./cache-timer";
import type { MetricsRow } from "./types";

const SEC = 1000;
const MIN = 60 * SEC;
const C = "conv";

const ev = {
  turnStart: (turnId: string): AgentEvent => ({ type: "turn-start", conversationId: C, turnId }),
  userMessage: (turnId: string): AgentEvent => ({
    type: "user-message",
    conversationId: C,
    turnId,
    text: "hi",
  }),
  text: (turnId: string): AgentEvent => ({
    type: "text-delta",
    conversationId: C,
    turnId,
    delta: "x",
  }),
  call: (turnId: string, stepId: string, toolCallId: string): AgentEvent => ({
    type: "tool-call",
    conversationId: C,
    turnId,
    stepId: stepId as StepId,
    toolCallId,
    toolName: "t",
    input: {},
  }),
  result: (
    turnId: string,
    stepId: string,
    toolCallId: string,
    durationMs?: number,
  ): AgentEvent => ({
    type: "tool-result",
    conversationId: C,
    turnId,
    stepId: stepId as StepId,
    toolCallId,
    toolName: "t",
    content: "ok",
    isError: false,
    ...(durationMs !== undefined ? { durationMs } : {}),
  }),
  stepComplete: (turnId: string, stepId: string): AgentEvent => ({
    type: "step-complete",
    conversationId: C,
    turnId,
    stepId: stepId as StepId,
  }),
  usage: (turnId: string, stepId: string): AgentEvent => ({
    type: "usage",
    conversationId: C,
    turnId,
    stepId: stepId as StepId,
    usage: { inputTokens: 1, outputTokens: 1 },
  }),
  done: (turnId: string): AgentEvent => ({
    type: "done",
    conversationId: C,
    turnId,
    reason: "end-turn",
  }),
  error: (turnId: string): AgentEvent => ({
    type: "error",
    conversationId: C,
    turnId,
    message: "boom",
  }),
};

const noTurn = () => undefined;

/** Fold `[time, event]` pairs from the initial state. */
function run(
  steps: readonly (readonly [number, AgentEvent])[],
  start: CacheTimerState = initialCacheTimerState(),
  lastTurnId: () => string | undefined = noTurn,
): CacheTimerState {
  return steps.reduce((s, [at, e]) => foldCacheTimerEvent(s, e, at, lastTurnId), start);
}

describe("foldCacheTimerEvent — step gaps", () => {
  it("runs from step-complete while tools execute, and stamps when the last result returns", () => {
    const s1 = run([
      [0, ev.turnStart("t1")],
      [100, ev.call("t1", "t1#0", "a")],
      [110, ev.call("t1", "t1#0", "b")],
      [1_000, ev.stepComplete("t1", "t1#0")],
    ]);
    expect(s1.running).toMatchObject({
      kind: "step",
      stepId: "t1#0",
      startedAt: 1_000,
      toolCount: 2,
    });

    const s2 = run([[4_000, ev.result("t1", "t1#0", "a")]], s1);
    expect(s2.running?.kind).toBe("step"); // still waiting on "b"
    expect(s2.stepStamps.size).toBe(0);

    const s3 = run([[13_000, ev.result("t1", "t1#0", "b")]], s2);
    expect(s3.running).toBeNull();
    expect(s3.stepStamps.get("t1#0")).toBe(12_000);
  });

  it("stamps each step of a multi-step turn separately", () => {
    const s = run([
      [0, ev.call("t1", "t1#0", "a")],
      [1_000, ev.stepComplete("t1", "t1#0")],
      [3_000, ev.result("t1", "t1#0", "a")],
      [5_000, ev.call("t1", "t1#1", "b")],
      [6_000, ev.stepComplete("t1", "t1#1")],
      [66_000, ev.result("t1", "t1#1", "b")],
    ]);
    expect(s.stepStamps.get("t1#0")).toBe(2_000);
    expect(s.stepStamps.get("t1#1")).toBe(60_000);
  });

  it("uses the backend tool duration when it exceeds the wall clock (late-join replay burst)", () => {
    const s = run([
      [5_000, ev.call("t1", "t1#0", "a")],
      [5_000, ev.stepComplete("t1", "t1#0")],
      [5_000, ev.result("t1", "t1#0", "a", 42_000)],
    ]);
    expect(s.stepStamps.get("t1#0")).toBe(42_000);
  });

  it("stops at the next step's output when a result never matched (fallback)", () => {
    const s = run([
      [0, ev.call("t1", "t1#0", "a")],
      [1_000, ev.stepComplete("t1", "t1#0")],
      [9_000, ev.text("t1")],
    ]);
    expect(s.running).toBeNull();
    expect(s.stepStamps.get("t1#0")).toBe(8_000);
  });

  it("stops on a tool-call or usage from a DIFFERENT step, not its own", () => {
    const base = run([
      [0, ev.call("t1", "t1#0", "a")],
      [1_000, ev.stepComplete("t1", "t1#0")],
    ]);
    expect(run([[2_000, ev.usage("t1", "t1#0")]], base).running?.kind).toBe("step");
    expect(run([[3_000, ev.usage("t1", "t1#1")]], base).stepStamps.get("t1#0")).toBe(2_000);
    expect(run([[4_000, ev.call("t1", "t1#1", "z")]], base).stepStamps.get("t1#0")).toBe(3_000);
  });

  it("discards a step with no tool calls (the final step of a turn)", () => {
    const s = run([
      [1_000, ev.stepComplete("t1", "t1#0")],
      [1_050, ev.done("t1")],
    ]);
    expect(s.stepStamps.size).toBe(0);
    expect(s.running).toEqual({ kind: "turn", turnId: "t1", startedAt: 1_050 });
  });

  it("stamps a step whose tools were still running when the turn ended (stopped)", () => {
    const s = run([
      [0, ev.call("t1", "t1#0", "a")],
      [1_000, ev.stepComplete("t1", "t1#0")],
      [21_000, ev.done("t1")],
    ]);
    expect(s.stepStamps.get("t1#0")).toBe(20_000);
    expect(s.running?.kind).toBe("turn");
  });
});

describe("foldCacheTimerEvent — turn gaps", () => {
  it("starts at done and is stamped on that turn when the next turn starts", () => {
    const s = run([
      [1_000, ev.done("t1")],
      [91_000, ev.userMessage("t2")],
      [91_500, ev.turnStart("t2")],
    ]);
    expect(s.running).toBeNull();
    expect(s.turnStamps.get("t1")).toBe(90_000);
  });

  it("an error also ends the turn", () => {
    expect(run([[7, ev.error("t1")]]).running).toEqual({
      kind: "turn",
      turnId: "t1",
      startedAt: 7,
    });
  });

  it("stopTurnGap stamps on a local send", () => {
    const s = stopTurnGap(run([[1_000, ev.done("t1")]]), 4_000, noTurn);
    expect(s.running).toBeNull();
    expect(s.turnStamps.get("t1")).toBe(3_000);
  });

  it("stopTurnGap is a no-op while a step gap runs", () => {
    const base = run([
      [0, ev.call("t1", "t1#0", "a")],
      [1_000, ev.stepComplete("t1", "t1#0")],
    ]);
    expect(stopTurnGap(base, 2_000, noTurn)).toBe(base);
  });
});

describe("seedTurnGap", () => {
  it("seeds a turn gap with no turnId, stamped on the most recent turn when stopped", () => {
    const seeded = seedTurnGap(initialCacheTimerState(), 1_000);
    expect(seeded.running).toEqual({ kind: "turn", turnId: null, startedAt: 1_000 });
    const s = stopTurnGap(seeded, 61_000, () => "t9");
    expect(s.turnStamps.get("t9")).toBe(60_000);
  });

  it("drops a seeded gap when the most recent turn is unknown", () => {
    const s = stopTurnGap(seedTurnGap(initialCacheTimerState(), 1_000), 2_000, noTurn);
    expect(s.running).toBeNull();
    expect(s.turnStamps.size).toBe(0);
  });

  it("keeps the later start, never overrides a step gap, ignores non-finite", () => {
    const live = run([[5_000, ev.done("t1")]]);
    expect(seedTurnGap(live, 4_000).running).toEqual({
      kind: "turn",
      turnId: "t1",
      startedAt: 5_000,
    });
    expect(seedTurnGap(live, 6_000).running).toEqual({
      kind: "turn",
      turnId: "t1",
      startedAt: 6_000,
    });
    const step = run([
      [0, ev.call("t1", "t1#0", "a")],
      [1_000, ev.stepComplete("t1", "t1#0")],
    ]);
    expect(seedTurnGap(step, 9_000)).toBe(step);
    expect(seedTurnGap(initialCacheTimerState(), Number.NaN).running).toBeNull();
  });
});

describe("viewCacheTimer", () => {
  it("formats m:ss up to 10 minutes", () => {
    expect(viewCacheTimer(0).label).toBe("0:00");
    expect(viewCacheTimer(9 * SEC + 999).label).toBe("0:09");
    expect(viewCacheTimer(MIN + 5 * SEC).label).toBe("1:05");
    expect(viewCacheTimer(5 * MIN + 30 * SEC).label).toBe("5:30");
    expect(viewCacheTimer(9 * MIN + 59 * SEC).label).toBe("9:59");
    expect(viewCacheTimer(9 * MIN + 59 * SEC).capped).toBe(false);
  });

  it("reads '10+ min' and is capped at and past 10 minutes", () => {
    expect(viewCacheTimer(CACHE_TIMER_MAX_MS)).toEqual({
      label: "10+ min",
      level: "error",
      capped: true,
    });
    expect(viewCacheTimer(3 * 60 * MIN).label).toBe("10+ min");
  });

  it("colours by the 5-minute cache TTL", () => {
    expect(viewCacheTimer(3 * MIN + 59 * SEC).level).toBe("success");
    expect(viewCacheTimer(4 * MIN).level).toBe("warning");
    expect(viewCacheTimer(CACHE_TTL_MS).level).toBe("error");
    expect(viewCacheTimer(7 * MIN).level).toBe("error");
  });

  it("clamps negative / non-finite elapsed (clock skew) to 0:00", () => {
    expect(viewCacheTimer(-5 * SEC).label).toBe("0:00");
    expect(viewCacheTimer(Number.NaN).label).toBe("0:00");
  });
});

function userRow(text = "hi"): MetricsRow {
  const group: RenderGroup = {
    kind: "single",
    chunk: { seq: null, role: "user", chunk: { type: "text", text }, provisional: true },
  };
  return { kind: "group", group };
}

function assistantRow(turnId: string): MetricsRow {
  const group: RenderGroup = {
    kind: "single",
    chunk: {
      seq: 1,
      role: "assistant",
      chunk: { type: "text", text: "ok" },
      provisional: false,
      turnId,
    },
  };
  return { kind: "group", group };
}

function turnRow(turnId: string, turnNumber: number): MetricsRow {
  const usage = { inputTokens: 10, outputTokens: 5 };
  const turn: TurnMetrics = { turnId, usage, steps: [{ stepId: `${turnId}#0` as StepId, usage }] };
  return {
    kind: "turn-metrics",
    turn,
    turnNumber,
    cumulativeUsage: usage,
    prevLastStepUsage: null,
  };
}

describe("lastTurnRowIndex", () => {
  it("picks the LAST turn-metrics row", () => {
    const rows = [
      userRow(),
      assistantRow("t1"),
      turnRow("t1", 1),
      userRow(),
      assistantRow("t2"),
      turnRow("t2", 2),
    ];
    expect(lastTurnRowIndex(rows)).toBe(5);
  });

  it("is null once a user message follows the last turn", () => {
    expect(lastTurnRowIndex([userRow(), turnRow("t1", 1), userRow("next")])).toBeNull();
  });

  it("skips trailing non-user rows after the turn row", () => {
    expect(lastTurnRowIndex([userRow(), turnRow("t1", 1), assistantRow("t1")])).toBe(1);
  });

  it("is null with no turn-metrics rows", () => {
    expect(lastTurnRowIndex([])).toBeNull();
    expect(lastTurnRowIndex([userRow(), assistantRow("t1")])).toBeNull();
  });
});
