// End-to-end placement scenarios: real transcript + metrics reducers fed real
// AgentEvents, rendered through groupRenderedChunks → interleaveTurnMetrics.
// The invariant under test: at EVERY point of a turn (not just after it ends),
// each turn's metrics sit under that turn — never under a neighbour.
import type { AgentEvent, StepId, StoredChunk, TurnMetrics, Usage } from "@dispatch/wire";
import { describe, expect, it } from "vitest";
import {
  appendUserMessage,
  applyHistory,
  foldEvent,
  groupRenderedChunks,
  initialState,
  selectChunks,
  type TranscriptState,
  trimTranscript,
} from "../chunks";
import { interleaveTurnMetrics } from "./place";
import {
  applyDurableMetrics,
  foldMetricsEvent,
  initialMetricsState,
  selectOrderedTurnMetrics,
} from "./reducer";
import type { MetricsRow, MetricsState } from "./types";

const C = "c1";
const u = (i: number, o: number): Usage => ({ inputTokens: i, outputTokens: o });

/** Ordered list of "what follows each user text bubble / which turn rows appear where". */
function layout(rows: readonly MetricsRow[]): string[] {
  const out: string[] = [];
  for (const r of rows) {
    if (r.kind === "turn-metrics") out.push(`[turn ${r.turn.turnId}]`);
    else if (r.kind === "step-metrics") out.push(`[step ${r.step.stepId}]`);
    else if (r.group.kind === "single") {
      const c = r.group.chunk.chunk;
      if (c.type === "text") out.push(`${r.group.chunk.role}:${c.text}`);
      else if (c.type === "image") out.push(`${r.group.chunk.role}:<img>`);
      else if (c.type === "error") out.push(`error:${c.message}`);
    } else {
      out.push(`tool:${r.group.entry.toolCallId}`);
    }
  }
  return out;
}

class Sim {
  t: TranscriptState = initialState();
  m: MetricsState = initialMetricsState();
  seq = 0;
  /** Durable server-side log (what loadSince returns). */
  log: StoredChunk[] = [];
  durable: TurnMetrics[] = [];

  constructor(private readonly legacy = false) {}

  private ev(e: AgentEvent): void {
    this.t = foldEvent(this.t, e);
    this.m = foldMetricsEvent(this.m, e);
  }

  private persist(role: StoredChunk["role"], chunk: StoredChunk["chunk"], turnId: string): void {
    this.seq++;
    this.log.push(
      this.legacy ? { seq: this.seq, role, chunk } : { seq: this.seq, role, chunk, turnId },
    );
  }

  /** The sender types + sends (optimistic echo), optionally with an image. */
  send(text: string, image = false): void {
    this.t = appendUserMessage(
      this.t,
      text,
      image ? [{ url: "data:image/png;base64,AA", mimeType: "image/png" }] : undefined,
    );
  }

  start(turnId: string, text: string, image = false): void {
    this.ev({ type: "turn-start", conversationId: C, turnId } as AgentEvent);
    this.ev({ type: "user-message", conversationId: C, turnId, text } as AgentEvent);
    this.persist("user", { type: "text", text }, turnId);
    if (image) this.persist("user", { type: "image", url: "/images/c1/x.png" }, turnId);
  }

  text(turnId: string, text: string): void {
    this.ev({ type: "text-delta", conversationId: C, turnId, delta: text } as AgentEvent);
  }

  toolStep(turnId: string, step: number, id: string): void {
    const stepId = `${turnId}#${step}` as StepId;
    this.ev({
      type: "tool-call",
      conversationId: C,
      turnId,
      stepId,
      toolCallId: id,
      toolName: "t",
      input: {},
    } as AgentEvent);
    this.completeStep(turnId, step);
    this.ev({
      type: "tool-result",
      conversationId: C,
      turnId,
      stepId,
      toolCallId: id,
      toolName: "t",
      content: "ok",
      isError: false,
    } as AgentEvent);
    this.persist(
      "assistant",
      { type: "tool-call", toolCallId: id, toolName: "t", input: {}, stepId },
      turnId,
    );
    this.persist(
      "tool",
      { type: "tool-result", toolCallId: id, toolName: "t", content: "ok", isError: false, stepId },
      turnId,
    );
  }

  completeStep(turnId: string, step: number): void {
    const stepId = `${turnId}#${step}` as StepId;
    this.ev({ type: "usage", conversationId: C, turnId, stepId, usage: u(100, 10) } as AgentEvent);
    this.ev({
      type: "step-complete",
      conversationId: C,
      turnId,
      stepId,
      ttftMs: 100,
      decodeMs: 100,
      genTotalMs: 200,
    } as AgentEvent);
  }

  steer(turnId: string, text: string): void {
    this.ev({ type: "steering", conversationId: C, turnId, text } as AgentEvent);
    this.persist("user", { type: "text", text }, turnId);
  }

  /** Finish a turn: final text step, done, seal, then history + metrics sync. */
  finish(turnId: string, text: string, finalStep: number): void {
    this.text(turnId, text);
    this.completeStep(turnId, finalStep);
    this.ev({
      type: "done",
      conversationId: C,
      turnId,
      reason: "stop",
      durationMs: 500,
      usage: u(100, 10),
    } as AgentEvent);
    this.persist("assistant", { type: "text", text }, turnId);
    this.ev({ type: "turn-sealed", conversationId: C, turnId } as AgentEvent);
    this.sync(turnId, finalStep);
  }

  /** A turn that errors (never seals); backend persists its partial metrics. */
  fail(turnId: string, message: string, steps: number): void {
    this.ev({ type: "error", conversationId: C, turnId, message } as AgentEvent);
    this.persist("assistant", { type: "error", message }, turnId);
    this.t = applyHistory(this.t, this.log);
    if (steps > 0) this.syncMetricsFor(turnId, steps - 1);
  }

  private syncMetricsFor(turnId: string, lastStep: number): void {
    const steps = [];
    for (let i = 0; i <= lastStep; i++) {
      steps.push({ stepId: `${turnId}#${i}` as StepId, usage: u(100, 10), decodeMs: 100 });
    }
    this.durable.push({ turnId, usage: u(100 * steps.length, 10 * steps.length), steps });
    this.m = applyDurableMetrics(this.m, this.durable);
  }

  private sync(turnId: string, lastStep: number): void {
    this.t = applyHistory(this.t, this.log);
    this.syncMetricsFor(turnId, lastStep);
  }

  trim(limit: number): void {
    this.t = trimTranscript(this.t, limit);
  }

  layout(): string[] {
    const groups = groupRenderedChunks(selectChunks(this.t));
    return layout(interleaveTurnMetrics(groups, selectOrderedTurnMetrics(this.m)));
  }
}

/** Build a history of N text-only turns (t1..tN), each "qK" → "aK". */
function textHistory(sim: Sim, n: number): void {
  for (let k = 1; k <= n; k++) {
    sim.send(`q${k}`);
    sim.start(`t${k}`, `q${k}`);
    sim.finish(`t${k}`, `a${k}`, 0);
  }
}

for (const legacy of [false, true]) {
  // `legacy`: the persisted rows carry NO turnId (history written before the
  // backend stamped it). Live chunks always carry it.
  describe(`placement stays exact through a turn (${legacy ? "legacy rows" : "turnId rows"})`, () => {
    it("plain text turns", () => {
      const sim = new Sim(legacy);
      textHistory(sim, 3);
      expect(sim.layout()).toEqual([
        "user:q1",
        "assistant:a1",
        "[turn t1]",
        "user:q2",
        "assistant:a2",
        "[turn t2]",
        "user:q3",
        "assistant:a3",
        "[turn t3]",
      ]);
    });

    it("never shifts while a new turn is sent and streams — even after older turns were unloaded", () => {
      const sim = new Sim(legacy);
      textHistory(sim, 4);
      sim.trim(5); // 8 chunks > 5 → unloads whole quarters: q1 a1 q2 a2
      const before = sim.layout();
      expect(before).toEqual([
        "user:q3",
        "assistant:a3",
        "[turn t3]",
        "user:q4",
        "assistant:a4",
        "[turn t4]",
      ]);

      const expectStable = () => expect(sim.layout().slice(0, before.length)).toEqual(before);

      sim.send("q5");
      expectStable(); // just sent (optimistic echo, no turn yet)
      sim.start("t5", "q5");
      expectStable(); // turn started
      sim.toolStep("t5", 0, "k1");
      expectStable(); // tool step completed (metrics entry exists, not done)
      sim.text("t5", "partial…");
      expectStable(); // streaming text
      sim.finish("t5", "a5", 1);
      expect(sim.layout()).toEqual([
        ...before,
        "user:q5",
        "tool:k1",
        "[step t5#0]",
        "assistant:a5",
        "[turn t5]",
      ]);
    });

    it("image attachments never shift other turns' metrics", () => {
      const sim = new Sim(legacy);
      sim.send("q1");
      sim.start("t1", "q1");
      sim.finish("t1", "a1", 0);
      sim.send("q2", true);
      sim.start("t2", "q2", true);
      sim.finish("t2", "a2", 0);
      sim.send("q3");
      sim.start("t3", "q3");
      sim.finish("t3", "a3", 0);
      expect(sim.layout()).toEqual([
        "user:q1",
        "assistant:a1",
        "[turn t1]",
        "user:q2",
        "user:<img>",
        "assistant:a2",
        "[turn t2]",
        "user:q3",
        "assistant:a3",
        "[turn t3]",
      ]);
    });

    it("a mid-turn steering message keeps the turn total at the END of the turn", () => {
      const sim = new Sim(legacy);
      textHistory(sim, 1);
      sim.send("q2");
      sim.start("t2", "q2");
      sim.toolStep("t2", 0, "k1");
      sim.steer("t2", "steer!");
      // live, mid-turn: t1 untouched, steering bubble shows no totals
      expect(sim.layout()).toEqual([
        "user:q1",
        "assistant:a1",
        "[turn t1]",
        "user:q2",
        "tool:k1",
        "[step t2#0]",
        "user:steer!",
      ]);
      sim.toolStep("t2", 1, "k2");
      sim.finish("t2", "a2", 2);
      textHistoryFrom(sim, 3);
      expect(sim.layout()).toEqual([
        "user:q1",
        "assistant:a1",
        "[turn t1]",
        "user:q2",
        "tool:k1",
        "[step t2#0]",
        "user:steer!",
        "tool:k2",
        "[step t2#1]",
        "assistant:a2",
        "[turn t2]",
        "user:q3",
        "assistant:a3",
        "[turn t3]",
      ]);
    });

    it("an errored turn gets its own metrics and never shifts the others", () => {
      const sim = new Sim(legacy);
      textHistory(sim, 1);
      sim.send("q2");
      sim.start("t2", "q2");
      sim.text("t2", "partial");
      sim.completeStep("t2", 0);
      sim.fail("t2", "boom", 1);
      textHistoryFrom(sim, 3);
      const l = sim.layout();
      expect(l.indexOf("[turn t1]")).toBe(l.indexOf("assistant:a1") + 1);
      expect(l.indexOf("[turn t2]")).toBeGreaterThan(l.indexOf("error:boom"));
      expect(l.indexOf("[turn t2]")).toBeLessThan(l.indexOf("user:q3"));
      expect(l.indexOf("[turn t3]")).toBe(l.indexOf("assistant:a3") + 1);
    });

    it("an errored turn with NO metrics never steals another turn's", () => {
      const sim = new Sim(legacy);
      textHistory(sim, 1);
      sim.send("q2");
      sim.start("t2", "q2");
      sim.fail("t2", "boom", 0); // failed before any step → no metrics row
      textHistoryFrom(sim, 3);
      expect(sim.layout()).toEqual([
        "user:q1",
        "assistant:a1",
        "[turn t1]",
        "user:q2",
        "error:boom",
        "user:q3",
        "assistant:a3",
        "[turn t3]",
      ]);
    });

    it("a turn cut in half by the chat limit still shows its total under its visible tail", () => {
      const sim = new Sim(legacy);
      sim.send("q1");
      sim.start("t1", "q1");
      sim.toolStep("t1", 0, "k1");
      sim.toolStep("t1", 1, "k2");
      sim.finish("t1", "a1", 2);
      textHistoryFrom(sim, 2);
      // log: q1 call result call result a1 | q2 a2  → keep newest 6
      sim.trim(7);
      const l = sim.layout();
      expect(l).not.toContain("user:q1");
      expect(l.indexOf("[turn t1]")).toBe(l.indexOf("assistant:a1") + 1);
      expect(l.indexOf("[turn t2]")).toBe(l.indexOf("assistant:a2") + 1);
    });
  });
}

/** Continue a text history from turn `from` (one more turn). */
function textHistoryFrom(sim: Sim, from: number): void {
  sim.send(`q${from}`);
  sim.start(`t${from}`, `q${from}`);
  sim.finish(`t${from}`, `a${from}`, 0);
}
