import type { StepId, StepMetrics, TurnMetrics } from "@dispatch/wire";
import { describe, expect, it } from "vitest";
import type { RenderGroup } from "../chunks";
import { interleaveTurnMetrics } from "./place";
import type { MetricsRow, TurnMetricsEntry } from "./types";

function userGroup(seq: number, text: string): RenderGroup {
  return {
    kind: "single",
    chunk: {
      seq,
      role: "user",
      chunk: { type: "text", text },
      provisional: false,
    },
  };
}

function assistantGroup(seq: number, text: string): RenderGroup {
  return {
    kind: "single",
    chunk: {
      seq,
      role: "assistant",
      chunk: { type: "text", text },
      provisional: false,
    },
  };
}

function toolCallGroup(seq: number, stepId: string, toolCallId: string): RenderGroup {
  return {
    kind: "single",
    chunk: {
      seq,
      role: "assistant",
      chunk: {
        type: "tool-call",
        toolCallId,
        toolName: "test",
        input: {},
        stepId: stepId as StepId,
      },
      provisional: false,
    },
  };
}

function toolResultGroup(seq: number, stepId: string, toolCallId: string): RenderGroup {
  return {
    kind: "single",
    chunk: {
      seq,
      role: "tool",
      chunk: {
        type: "tool-result",
        toolCallId,
        toolName: "test",
        content: "",
        isError: false,
        stepId: stepId as StepId,
      },
      provisional: false,
    },
  };
}

function toolBatchGroup(stepId: string, toolCallIds: string[]): RenderGroup {
  return {
    kind: "tool-batch",
    stepId,
    entries: toolCallIds.map((id) => ({
      call: {
        type: "tool-call" as const,
        toolCallId: id,
        toolName: "test",
        input: {},
        stepId: stepId as StepId,
      },
      result: null,
    })),
    provisional: false,
  };
}

function makeStep(stepId: string, inputTokens: number, outputTokens: number): StepMetrics {
  return {
    stepId: stepId as StepId,
    usage: { inputTokens, outputTokens },
  };
}

function makeTurn(
  turnId: string,
  inputTokens: number,
  outputTokens: number,
  steps: StepMetrics[] = [],
): TurnMetrics {
  return {
    turnId,
    usage: { inputTokens, outputTokens },
    steps,
  };
}

function makeEntry(
  turnId: string,
  inputTokens: number,
  outputTokens: number,
  steps: StepMetrics[] = [],
): TurnMetricsEntry {
  return {
    turnId,
    steps,
    total: makeTurn(turnId, inputTokens, outputTokens, steps),
  };
}

function makeProgressiveEntry(turnId: string, steps: StepMetrics[]): TurnMetricsEntry {
  return {
    turnId,
    steps,
    total: null,
  };
}

function expectGroupAt(
  rows: readonly { readonly kind: string }[],
  index: number,
  expected: RenderGroup,
): void {
  const row = rows[index];
  expect(row?.kind).toBe("group");
  expect((row as { readonly group: RenderGroup } | undefined)?.group).toBe(expected);
}

function expectStepMetricsAt(
  rows: readonly { readonly kind: string }[],
  index: number,
  expectedStepId: string,
  expectedIndex: number,
): void {
  const row = rows[index];
  expect(row?.kind).toBe("step-metrics");
  const sm = row as { readonly step: StepMetrics; readonly index: number } | undefined;
  expect(sm?.step.stepId).toBe(expectedStepId);
  expect(sm?.index).toBe(expectedIndex);
}

function expectTurnMetricsAt(
  rows: readonly { readonly kind: string }[],
  index: number,
  expectedTurnId: string,
): void {
  const row = rows[index];
  expect(row?.kind).toBe("turn-metrics");
  expect((row as { readonly turn: TurnMetrics } | undefined)?.turn.turnId).toBe(expectedTurnId);
}

describe("interleaveTurnMetrics", () => {
  it("no metrics: rows are all groups, unchanged order", () => {
    const g1 = userGroup(1, "q");
    const g2 = assistantGroup(2, "a");
    const rows = interleaveTurnMetrics([g1, g2], []);
    expect(rows).toHaveLength(2);
    expectGroupAt(rows, 0, g1);
    expectGroupAt(rows, 1, g2);
  });

  it("head-aligned: segment i gets entries[i]", () => {
    const g1 = userGroup(1, "q1");
    const g2 = toolCallGroup(2, "s1", "c1");
    const g3 = userGroup(3, "q2");
    const g4 = toolCallGroup(4, "s2", "c2");
    const step1 = makeStep("s1", 100, 50);
    const step2 = makeStep("s2", 200, 80);
    const rows = interleaveTurnMetrics(
      [g1, g2, g3, g4],
      [makeEntry("t1", 100, 50, [step1]), makeEntry("t2", 200, 80, [step2])],
    );

    expect(rows).toHaveLength(8);
    expectGroupAt(rows, 0, g1);
    expectGroupAt(rows, 1, g2);
    expectStepMetricsAt(rows, 2, "s1", 0);
    expectTurnMetricsAt(rows, 3, "t1");
    expectGroupAt(rows, 4, g3);
    expectGroupAt(rows, 5, g4);
    expectStepMetricsAt(rows, 6, "s2", 0);
    expectTurnMetricsAt(rows, 7, "t2");
  });

  it("a trailing segment with no entry (in-flight turn) renders no metrics", () => {
    const g1 = userGroup(1, "q1");
    const g2 = toolCallGroup(2, "s1", "c1");
    const g3 = userGroup(3, "q2");
    const g4 = assistantGroup(4, "a2");
    const step = makeStep("s1", 100, 50);
    const rows = interleaveTurnMetrics([g1, g2, g3, g4], [makeEntry("t1", 100, 50, [step])]);

    expect(rows).toHaveLength(6);
    expectGroupAt(rows, 0, g1);
    expectGroupAt(rows, 1, g2);
    expectStepMetricsAt(rows, 2, "s1", 0);
    expectTurnMetricsAt(rows, 3, "t1");
    expectGroupAt(rows, 4, g3);
    expectGroupAt(rows, 5, g4);
  });

  it("single text-only turn: no step row (unanchored), turn-metrics at tail", () => {
    const g1 = userGroup(1, "q1");
    const g2 = assistantGroup(2, "a1");
    const step = makeStep("s1", 100, 50);
    const turn = makeEntry("t1", 100, 50, [step]);
    const rows = interleaveTurnMetrics([g1, g2], [turn]);

    expect(rows).toHaveLength(3);
    expectGroupAt(rows, 0, g1);
    expectGroupAt(rows, 1, g2);
    expectTurnMetricsAt(rows, 2, "t1");
  });

  it("tool step anchors inline after its tool-batch group", () => {
    const g1 = userGroup(1, "q1");
    const g2 = toolBatchGroup("t#0", ["c1", "c2"]);
    const g3 = assistantGroup(3, "a1");
    const step0 = makeStep("t#0", 100, 50);
    const step1 = makeStep("t#1", 200, 80);
    const turn = makeEntry("t1", 300, 130, [step0, step1]);
    const rows = interleaveTurnMetrics([g1, g2, g3], [turn]);

    expect(rows).toHaveLength(5);
    expectGroupAt(rows, 0, g1);
    expectGroupAt(rows, 1, g2);
    expectStepMetricsAt(rows, 2, "t#0", 0);
    expectGroupAt(rows, 3, g3);
    expectTurnMetricsAt(rows, 4, "t1");
  });

  it("single tool-call group anchors its step", () => {
    const g1 = userGroup(1, "q1");
    const g2 = toolCallGroup(2, "s1", "c1");
    const g3 = assistantGroup(3, "a1");
    const step = makeStep("s1", 100, 50);
    const turn = makeEntry("t1", 100, 50, [step]);
    const rows = interleaveTurnMetrics([g1, g2, g3], [turn]);

    expect(rows).toHaveLength(5);
    expectGroupAt(rows, 0, g1);
    expectGroupAt(rows, 1, g2);
    expectStepMetricsAt(rows, 2, "s1", 0);
    expectGroupAt(rows, 3, g3);
    expectTurnMetricsAt(rows, 4, "t1");
  });

  it("single tool-result group anchors its step", () => {
    const g1 = userGroup(1, "q1");
    const g2 = toolResultGroup(2, "s1", "c1");
    const g3 = assistantGroup(3, "a1");
    const step = makeStep("s1", 100, 50);
    const turn = makeEntry("t1", 100, 50, [step]);
    const rows = interleaveTurnMetrics([g1, g2, g3], [turn]);

    expect(rows).toHaveLength(5);
    expectGroupAt(rows, 0, g1);
    expectGroupAt(rows, 1, g2);
    expectStepMetricsAt(rows, 2, "s1", 0);
    expectGroupAt(rows, 3, g3);
    expectTurnMetricsAt(rows, 4, "t1");
  });

  it("multi-step: each tool step inline, unanchored text step skipped", () => {
    const g1 = userGroup(1, "q1");
    const g2 = toolBatchGroup("t#0", ["c1"]);
    const g3 = assistantGroup(2, "thinking");
    const g4 = toolBatchGroup("t#1", ["c2", "c3"]);
    const g5 = assistantGroup(3, "a1");
    const step0 = makeStep("t#0", 100, 50);
    const step1 = makeStep("t#1", 200, 80);
    const step2 = makeStep("t#2", 50, 20);
    const turn = makeEntry("t1", 350, 150, [step0, step1, step2]);
    const rows = interleaveTurnMetrics([g1, g2, g3, g4, g5], [turn]);

    expect(rows).toHaveLength(8);
    expectGroupAt(rows, 0, g1);
    expectGroupAt(rows, 1, g2);
    expectStepMetricsAt(rows, 2, "t#0", 0);
    expectGroupAt(rows, 3, g3);
    expectGroupAt(rows, 4, g4);
    expectStepMetricsAt(rows, 5, "t#1", 1);
    expectGroupAt(rows, 6, g5);
    expectTurnMetricsAt(rows, 7, "t1");
  });

  it("multiple turns head-aligned with inline steps", () => {
    const g1 = userGroup(1, "q1");
    const g2 = toolBatchGroup("s1", ["c1"]);
    const g3 = assistantGroup(2, "a1");
    const g4 = userGroup(3, "q2");
    const g5 = toolCallGroup(4, "s2", "c2");
    const step1 = makeStep("s1", 100, 50);
    const step2 = makeStep("s2", 200, 80);
    const rows = interleaveTurnMetrics(
      [g1, g2, g3, g4, g5],
      [makeEntry("t1", 100, 50, [step1]), makeEntry("t2", 200, 80, [step2])],
    );

    expect(rows).toHaveLength(9);
    expectGroupAt(rows, 0, g1);
    expectGroupAt(rows, 1, g2);
    expectStepMetricsAt(rows, 2, "s1", 0);
    expectGroupAt(rows, 3, g3);
    expectTurnMetricsAt(rows, 4, "t1");
    expectGroupAt(rows, 5, g4);
    expectGroupAt(rows, 6, g5);
    expectStepMetricsAt(rows, 7, "s2", 0);
    expectTurnMetricsAt(rows, 8, "t2");
  });

  it("unanchored step (stepId not in groups) is skipped — only turn-metrics", () => {
    const g1 = userGroup(1, "q1");
    const g2 = assistantGroup(2, "a1");
    const step0 = makeStep("orphan", 100, 50);
    const turn = makeEntry("t1", 100, 50, [step0]);
    const rows = interleaveTurnMetrics([g1, g2], [turn]);

    expect(rows).toHaveLength(3);
    expectGroupAt(rows, 0, g1);
    expectGroupAt(rows, 1, g2);
    expectTurnMetricsAt(rows, 2, "t1");
  });

  it("fewer metrics than segments: trailing segments are bare", () => {
    const g1 = userGroup(1, "q1");
    const g2 = toolCallGroup(2, "s1", "c1");
    const g3 = userGroup(3, "q2");
    const g4 = assistantGroup(4, "a2");
    const g5 = userGroup(5, "q3");
    const g6 = assistantGroup(6, "a3");
    const step = makeStep("s1", 300, 120);
    const rows = interleaveTurnMetrics(
      [g1, g2, g3, g4, g5, g6],
      [makeEntry("t1", 300, 120, [step])],
    );

    expect(rows).toHaveLength(8);
    expectGroupAt(rows, 0, g1);
    expectGroupAt(rows, 1, g2);
    expectStepMetricsAt(rows, 2, "s1", 0);
    expectTurnMetricsAt(rows, 3, "t1");
    expectGroupAt(rows, 4, g3);
    expectGroupAt(rows, 5, g4);
    expectGroupAt(rows, 6, g5);
    expectGroupAt(rows, 7, g6);
  });

  it("trimmed leading turns: a mixed tool+text transcript tail-aligns text-only turns to their OWN (newest) entries, not stale trimmed ones", () => {
    // A long conversation where the chat limit unloaded the oldest turn (t1).
    // Metrics still hold all three turns; the loaded transcript is turns 2-3.
    // Turn 2 is a tool turn (matched by stepId); turn 3 is text-only (no
    // stepId groups) — the failure case. The text-only turn MUST get its OWN
    // entry (t3), NOT the trimmed t1's stale metrics.
    const g3 = userGroup(3, "q2");
    const g4 = toolBatchGroup("s2", ["c2"]);
    const g5 = assistantGroup(4, "tool-reply");
    const g6 = userGroup(5, "q3");
    const g7 = assistantGroup(6, "text-reply");
    const step1 = makeStep("s1", 11, 1); // t1 (trimmed)
    const step2 = makeStep("s2", 22, 2); // t2 (loaded, tool)
    const step3 = makeStep("s3", 33, 3); // t3 (loaded, text-only — unanchored)
    const entries = [
      makeEntry("t1", 11, 1, [step1]),
      makeEntry("t2", 22, 2, [step2]),
      makeEntry("t3", 33, 3, [step3]),
    ];
    const rows = interleaveTurnMetrics([g3, g4, g5, g6, g7], entries);

    const tmRows = rows.filter(
      (r): r is Extract<MetricsRow, { kind: "turn-metrics" }> => r.kind === "turn-metrics",
    );
    // Two loaded turns → two turn-metrics rows. The trimmed t1 does NOT render.
    expect(tmRows).toHaveLength(2);
    // CRITICAL: the text-only turn (segment 1) got t3 (its own newest entry),
    // not t1 (the stale trimmed one). A misaligned head-align would show t1.
    expect(tmRows[1]?.turn.turnId).toBe("t3");
    expect(tmRows[0]?.turn.turnId).toBe("t2");
    // And t1 never appears as a rendered row.
    expect(tmRows.some((r) => r.turn.turnId === "t1")).toBe(false);
  });

  it("trimmed turn still counts toward the cumulative 'chat total' on the first visible turn", () => {
    // t1 is trimmed (no segment) but finalized; t2 is the loaded visible turn.
    // t2's "Chat Total" cumulative must INCLUDE t1's usage (the whole chat),
    // even though t1 renders no row of its own.
    const g1 = userGroup(2, "q2");
    const g2 = assistantGroup(3, "a2");
    const entries = [
      {
        turnId: "t1",
        steps: [],
        total: {
          turnId: "t1",
          usage: { inputTokens: 1000, outputTokens: 10, cacheReadTokens: 500 },
          steps: [],
        },
      },
      {
        turnId: "t2",
        steps: [],
        total: {
          turnId: "t2",
          usage: { inputTokens: 2000, outputTokens: 20, cacheReadTokens: 1600 },
          steps: [],
        },
      },
    ];
    const rows = interleaveTurnMetrics([g1, g2], entries);
    const tmRows = rows.filter(
      (r): r is Extract<MetricsRow, { kind: "turn-metrics" }> => r.kind === "turn-metrics",
    );
    // Only the loaded turn renders a row; the trimmed t1 does not.
    expect(tmRows).toHaveLength(1);
    expect(tmRows[0]?.turn.turnId).toBe("t2");
    // Cumulative includes BOTH turns (t1 + t2): input 3000, cacheRead 2100.
    expect(tmRows[0]?.cumulativeUsage.inputTokens).toBe(3000);
    expect(tmRows[0]?.cumulativeUsage.cacheReadTokens).toBe(2100);
    // Retention baseline is the prior finalized turn (t1, even though trimmed).
    expect(tmRows[0]?.prevTurnUsage?.inputTokens).toBe(1000);
    expect(tmRows[0]?.prevTurnUsage?.cacheReadTokens).toBe(500);
  });

  it("in-flight turn (no durationMs) still produces turn row", () => {
    const g1 = userGroup(1, "q1");
    const g2 = toolCallGroup(2, "s1", "c1");
    const step = makeStep("s1", 100, 50);
    const turn: TurnMetricsEntry = {
      turnId: "t1",
      steps: [step],
      total: {
        turnId: "t1",
        usage: { inputTokens: 100, outputTokens: 50 },
        steps: [step],
      },
    };
    const rows = interleaveTurnMetrics([g1, g2], [turn]);

    expect(rows).toHaveLength(4);
    expectStepMetricsAt(rows, 2, "s1", 0);
    expectTurnMetricsAt(rows, 3, "t1");
    const metricsRow = rows[3] as { readonly turn: TurnMetrics } | undefined;
    expect(metricsRow?.turn.durationMs).toBeUndefined();
  });

  it("leading non-turn groups emit as plain group rows", () => {
    const g0 = assistantGroup(1, "system msg");
    const g1 = userGroup(2, "q1");
    const g2 = toolCallGroup(3, "s1", "c1");
    const step = makeStep("s1", 100, 50);
    const rows = interleaveTurnMetrics([g0, g1, g2], [makeEntry("t1", 100, 50, [step])]);

    expect(rows).toHaveLength(5);
    expectGroupAt(rows, 0, g0);
    expect(rows[1]?.kind).toBe("group");
    expect(rows[2]?.kind).toBe("group");
    expectStepMetricsAt(rows, 3, "s1", 0);
    expectTurnMetricsAt(rows, 4, "t1");
  });

  it("trimmed turn (more metrics than segments) does NOT emit a standalone row at the top", () => {
    const g1 = userGroup(1, "q1");
    const g2 = toolCallGroup(2, "s1", "c1");
    const step1 = makeStep("s1", 100, 50);
    const step2 = makeStep("s2", 200, 80);
    const rows = interleaveTurnMetrics(
      [g1, g2],
      [makeEntry("t1", 100, 50, [step1]), makeEntry("t2", 200, 80, [step2])],
    );

    // t2's content was unloaded by the chat limit (no segment for it); its
    // metrics must NOT render a standalone row piled at the top. Only the
    // loaded turn's content + its matched metrics appear. (t2 still counts
    // toward the cumulative "chat total" — see the cache-total tests.)
    expect(rows).toHaveLength(4);
    expectGroupAt(rows, 0, g1);
    expectGroupAt(rows, 1, g2);
    expectStepMetricsAt(rows, 2, "s1", 0);
    expectTurnMetricsAt(rows, 3, "t1");
    // No standalone turn-metrics row for t2 anywhere.
    const tmRows = rows.filter((r) => r.kind === "turn-metrics");
    expect(tmRows).toHaveLength(1);
    expect((tmRows[0] as { readonly turn: TurnMetrics }).turn.turnId).toBe("t1");
  });

  it("turn with no steps emits only turn-metrics (no step-metrics)", () => {
    const g1 = userGroup(1, "q1");
    const g2 = assistantGroup(2, "a1");
    const rows = interleaveTurnMetrics([g1, g2], [makeEntry("t1", 100, 50)]);

    expect(rows).toHaveLength(3);
    expectGroupAt(rows, 0, g1);
    expectGroupAt(rows, 1, g2);
    expectTurnMetricsAt(rows, 2, "t1");
  });

  it("progressive: entry with steps but total=null emits step rows and NO turn-metrics row", () => {
    const g1 = userGroup(1, "q1");
    const g2 = toolBatchGroup("s1", ["c1"]);
    const g3 = assistantGroup(2, "a1");
    const step1 = makeStep("s1", 100, 50);
    const entry = makeProgressiveEntry("t1", [step1]);
    const rows = interleaveTurnMetrics([g1, g2, g3], [entry]);

    expect(rows).toHaveLength(4);
    expectGroupAt(rows, 0, g1);
    expectGroupAt(rows, 1, g2);
    expectStepMetricsAt(rows, 2, "s1", 0);
    expectGroupAt(rows, 3, g3);
  });

  it("entry with total emits step rows + a turn-metrics row", () => {
    const g1 = userGroup(1, "q1");
    const g2 = toolBatchGroup("s1", ["c1"]);
    const g3 = assistantGroup(2, "a1");
    const step1 = makeStep("s1", 100, 50);
    const entry = makeEntry("t1", 100, 50, [step1]);
    const rows = interleaveTurnMetrics([g1, g2, g3], [entry]);

    expect(rows).toHaveLength(5);
    expectGroupAt(rows, 0, g1);
    expectGroupAt(rows, 1, g2);
    expectStepMetricsAt(rows, 2, "s1", 0);
    expectGroupAt(rows, 3, g3);
    expectTurnMetricsAt(rows, 4, "t1");
  });

  it("progressive multi-step: unanchored steps skipped, no turn-metrics", () => {
    const g1 = userGroup(1, "q1");
    const g2 = assistantGroup(2, "a1");
    const step0 = makeStep("s1", 100, 50);
    const step1 = makeStep("s2", 200, 80);
    const entry = makeProgressiveEntry("t1", [step0, step1]);
    const rows = interleaveTurnMetrics([g1, g2], [entry]);

    expect(rows).toHaveLength(2);
    expectGroupAt(rows, 0, g1);
    expectGroupAt(rows, 1, g2);
  });
});

describe("interleaveTurnMetrics — cumulative usage (cache total)", () => {
  function turnMetricsRows(rows: readonly MetricsRow[]) {
    return rows.filter((r): r is Extract<MetricsRow, { kind: "turn-metrics" }> => {
      return r.kind === "turn-metrics";
    });
  }

  function cacheEntry(
    turnId: string,
    inputTokens: number,
    outputTokens: number,
    cacheReadTokens: number,
  ): TurnMetricsEntry {
    const total: TurnMetrics = {
      turnId,
      usage: { inputTokens, outputTokens, cacheReadTokens },
      steps: [],
    };
    return { turnId, steps: [], total };
  }

  it("turn-metrics row carries this turn's usage and the running cumulative", () => {
    const rows = interleaveTurnMetrics(
      [userGroup(1, "q1"), assistantGroup(2, "a1")],
      [makeEntry("t1", 1000, 100)],
    );
    const tm = turnMetricsRows(rows);
    expect(tm).toHaveLength(1);
    expect(tm[0]?.turn.turnId).toBe("t1");
    expect(tm[0]?.cumulativeUsage).toEqual({ inputTokens: 1000, outputTokens: 100 });
  });

  it("accumulates cache read + input across turns (chat total)", () => {
    const rows = interleaveTurnMetrics(
      [userGroup(1, "q1"), assistantGroup(2, "a1"), userGroup(3, "q2"), assistantGroup(4, "a2")],
      [cacheEntry("t1", 2669, 10, 384), cacheEntry("t2", 2737, 10, 2560)],
    );
    const tm = turnMetricsRows(rows);
    expect(tm).toHaveLength(2);
    // turn 1: only its own usage
    expect(tm[0]?.cumulativeUsage.inputTokens).toBe(2669);
    expect(tm[0]?.cumulativeUsage.cacheReadTokens).toBe(384);
    // turn 2: sum of both (input 5406, cacheRead 2944 → matches the backend's 54% example)
    expect(tm[1]?.cumulativeUsage.inputTokens).toBe(5406);
    expect(tm[1]?.cumulativeUsage.cacheReadTokens).toBe(2944);
  });

  it("an in-flight (total=null) turn does not contribute to the cumulative", () => {
    const rows = interleaveTurnMetrics(
      [userGroup(1, "q1"), assistantGroup(2, "a1"), userGroup(3, "q2"), assistantGroup(4, "a2")],
      [cacheEntry("t1", 1000, 10, 500), makeProgressiveEntry("t2", [makeStep("s1", 200, 5)])],
    );
    const tm = turnMetricsRows(rows);
    // only the finalized turn emits a turn-metrics row; its cumulative is just itself
    expect(tm).toHaveLength(1);
    expect(tm[0]?.cumulativeUsage.inputTokens).toBe(1000);
    expect(tm[0]?.cumulativeUsage.cacheReadTokens).toBe(500);
  });

  it("carries the prior finalized turn's usage as the retention baseline", () => {
    const rows = interleaveTurnMetrics(
      [userGroup(1, "q1"), assistantGroup(2, "a1"), userGroup(3, "q2"), assistantGroup(4, "a2")],
      [cacheEntry("t1", 2669, 10, 384), cacheEntry("t2", 2737, 10, 2560)],
    );
    const tm = turnMetricsRows(rows);
    // first finalized turn has no earlier baseline
    expect(tm[0]?.prevTurnUsage).toBeNull();
    // second turn's baseline is the first turn's usage
    expect(tm[1]?.prevTurnUsage?.inputTokens).toBe(2669);
    expect(tm[1]?.prevTurnUsage?.cacheReadTokens).toBe(384);
  });
});
