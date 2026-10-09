/**
 * Probe: subscribe to a conversation over WS, capture the late-join replay,
 * and report event counts / bytes / time-to-receive. Saves to /tmp/replay-<id>.json.
 *   bun scripts/probe-replay.ts <conversationId> [wsUrl]
 */
const conv = process.argv[2];
const url = process.argv[3] ?? "ws://localhost:24990";
if (!conv) throw new Error("conversation id required");

const ws = new WebSocket(url);
const events: unknown[] = [];
let bytes = 0;
let t0 = 0;
let lastAt = 0;
ws.onopen = () => {
  t0 = performance.now();
  ws.send(JSON.stringify({ type: "chat.subscribe", conversationId: conv }));
};
ws.onmessage = (ev) => {
  const s = String(ev.data);
  const m = JSON.parse(s);
  if (m.type !== "chat.delta") return;
  bytes += s.length;
  lastAt = performance.now();
  events.push(m.event);
};
setTimeout(
  async () => {
    ws.close();
    const counts: Record<string, number> = {};
    for (const e of events as { type: string }[]) counts[e.type] = (counts[e.type] ?? 0) + 1;
    console.log({ events: events.length, bytes, recvMs: Math.round(lastAt - t0), counts });
    await Bun.write(`/tmp/replay-${conv}.json`, JSON.stringify(events));
  },
  Number(process.env.WAIT_MS ?? 3000),
);
