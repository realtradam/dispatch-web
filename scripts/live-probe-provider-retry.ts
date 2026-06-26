/**
 * scripts/live-probe-provider-retry.ts — FOCUSED live probe of the transient
 * `provider-retry` AgentEvent seam, run against a RUNNING backend (bin/up).
 * NOT part of `bun run test`.
 *
 * A real `provider-retry` only fires on an upstream 429/5xx, which we can't
 * force from here. So this probe verifies the two things unit tests CAN'T:
 *
 *  1. REGRESSION (real wire): a normal text turn through the REAL WS socket +
 *     the updated `foldEvent` (provider-retry case + the reduceEvent wrapper)
 *     seals cleanly and `providerRetry` stays NULL throughout — no spurious
 *     banner, and the wrapper's re-spread didn't break streaming.
 *  2. PARSER + REDUCER SEAM (the new event's effectful boundary): feed a
 *     synthetic `provider-retry` `chat.delta` JSON string through the REAL
 *     `parseServerMessage` wire parser (the function that runs on every inbound
 *     WS frame) → confirm it is ACCEPTED (not rejected as an unknown event) →
 *     `foldEvent` SETS `providerRetry` (coalesces on a 2nd) and adds NO chunk →
 *     a subsequent `text-delta` CLEARS it. This proves the new variant survives
 *     the JSON-parse boundary the unit tests skip (they pass constructed events).
 *
 *     bun scripts/live-probe-provider-retry.ts
 *     PROBE_MODEL=opencode/glm-5.2 bun scripts/live-probe-provider-retry.ts
 */
import type { ChatDeltaMessage, ChatErrorMessage } from "@dispatch/transport-contract";
import type { SurfaceServerMessage } from "@dispatch/ui-contract";
import { createSurfaceSocket } from "../src/adapters/ws/index.ts";
import { parseServerMessage } from "../src/adapters/ws/logic.ts";
import {
  foldEvent,
  initialState,
  selectChunks,
  selectProviderRetry,
} from "../src/core/chunks/index.ts";

const WS_URL = process.env.PROBE_WS ?? "ws://localhost:24205";
const MODEL = process.env.PROBE_MODEL ?? "opencode/deepseek-v4-flash";
const PROMPT = process.env.PROBE_PROMPT ?? "Reply with exactly: ok";

type ChatMsg = ChatDeltaMessage | ChatErrorMessage;

const checks: { name: string; ok: boolean; detail?: string }[] = [];
const record = (name: string, ok: boolean, detail?: string) => {
  checks.push({ name, ok, ...(detail !== undefined ? { detail } : {}) });
  console.log(`  ${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const fail = (msg: string): never => {
  console.error(`\n[probe] FATAL: ${msg}`);
  process.exit(1);
};

/** A chat.delta JSON frame carrying the given AgentEvent, exactly as the backend sends. */
function deltaFrame(event: ChatDeltaMessage["event"]): string {
  return JSON.stringify({ type: "chat.delta", event } satisfies ChatDeltaMessage);
}

async function main() {
  console.log(`[probe] provider-retry seam · model=${MODEL} · WS=${WS_URL}\n`);

  // ─── 1. REGRESSION: a real text turn through the updated foldEvent ──────────
  // Routed by conversationId via a per-conv handler map (same pattern as live-probe.ts).
  const handlers = new Map<string, (msg: ChatMsg) => void>();
  const socket = createSurfaceSocket({
    url: WS_URL,
    onMessage: (_m: SurfaceServerMessage) => {},
    onChat: (msg: ChatMsg) => {
      const id = msg.type === "chat.error" ? msg.conversationId : msg.event.conversationId;
      const h = id !== undefined ? handlers.get(id) : undefined;
      h?.(msg);
    },
  });
  await new Promise((r) => setTimeout(r, 500));

  const conversationId = crypto.randomUUID();
  let state = initialState();
  let deltas = 0;
  let sealed = false;
  let error: string | null = null;
  const done = Promise.withResolvers<void>();
  handlers.set(conversationId, (msg) => {
    if (msg.type === "chat.error") {
      error = msg.message;
      done.resolve();
      return;
    }
    deltas++;
    state = foldEvent(state, msg.event);
    if (msg.event.type === "turn-sealed") {
      sealed = true;
      done.resolve();
    }
  });

  socket.send({ type: "chat.send", conversationId, message: PROMPT, model: MODEL });
  const timeout = setTimeout(() => done.resolve(), 90_000);
  await done.promise;
  clearTimeout(timeout);
  handlers.delete(conversationId);

  record(
    "regression: a real text turn sealed cleanly",
    sealed && error === null,
    `${deltas} deltas${error ? ` err=${error}` : ""}`,
  );
  record(
    "regression: providerRetry stayed NULL through a normal turn (no spurious banner)",
    selectProviderRetry(state) === null,
  );

  // ─── 2. PARSER + REDUCER SEAM: synthetic provider-retry through the REAL parser ─
  console.log("\n[probe] parser+reducer seam (synthetic provider-retry)");
  let s = initialState();
  s = foldEvent(s, { type: "turn-start", conversationId, turnId: "t1" });

  const retryJson = deltaFrame({
    type: "provider-retry",
    conversationId,
    turnId: "t1",
    attempt: 0,
    delayMs: 5000,
    message: 'HTTP 429: {"error":{"type":"overloaded_error","message":"overloaded"}}',
    code: "429",
  });
  const parsed1 = parseServerMessage(retryJson);
  record(
    "REAL parseServerMessage ACCEPTS a provider-retry chat.delta (not rejected as unknown)",
    parsed1 !== null && parsed1.type === "chat.delta" && parsed1.event.type === "provider-retry",
    parsed1 ? `event.type=${(parsed1 as { event: { type: string } }).event.type}` : "parsed=null",
  );

  if (parsed1 !== null && parsed1.type === "chat.delta") s = foldEvent(s, parsed1.event);
  const retry1 = selectProviderRetry(s);
  record(
    "foldEvent SETS providerRetry from the PARSED event",
    retry1 !== null && retry1.attempt === 0 && retry1.delayMs === 5000 && retry1.code === "429",
    retry1 ? `attempt=${retry1.attempt} delay=${retry1.delayMs}ms code=${retry1.code}` : "null",
  );
  record(
    "provider-retry adds NO chunk (never persisted — never pollutes the prompt)",
    selectChunks(s).length === 0,
    `${selectChunks(s).length} chunk(s)`,
  );

  const retry2Json = deltaFrame({
    type: "provider-retry",
    conversationId,
    turnId: "t1",
    attempt: 1,
    delayMs: 10000,
    message: "HTTP 429: still overloaded",
    code: "429",
  });
  const parsed2 = parseServerMessage(retry2Json);
  if (parsed2 !== null && parsed2.type === "chat.delta") s = foldEvent(s, parsed2.event);
  const retry2 = selectProviderRetry(s);
  record(
    "a 2nd provider-retry COALESCES (latest attempt + delay replaces previous)",
    retry2 !== null &&
      retry2.attempt === 1 &&
      retry2.delayMs === 10000 &&
      retry2.message === "HTTP 429: still overloaded",
    retry2 ? `attempt=${retry2.attempt} delay=${retry2.delayMs}ms` : "null",
  );

  const textJson = deltaFrame({
    type: "text-delta",
    conversationId,
    turnId: "t1",
    delta: "here is the reply",
  });
  const parsedText = parseServerMessage(textJson);
  if (parsedText !== null && parsedText.type === "chat.delta") s = foldEvent(s, parsedText.event);
  record(
    "a subsequent text-delta CLEARS the banner (retry succeeded → live reply)",
    selectProviderRetry(s) === null,
  );
  record(
    "…and the text-delta content DID land as a chunk (the reply streams normally after retries)",
    selectChunks(s).some((c) => c.chunk.type === "text"),
  );

  socket.close();
  const passed = checks.filter((c) => c.ok).length;
  const total = checks.length;
  console.log(`\n[probe] ${passed}/${total} checks passed`);
  process.exit(passed === total ? 0 : 1);
}

main().catch((e) => fail(String(e)));
