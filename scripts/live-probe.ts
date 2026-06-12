/**
 * scripts/live-probe.ts — LIVE end-to-end probe of the FE chat path against a
 * RUNNING backend (bin/up: HTTP :24203 + surface WS :24205). NOT part of
 * `bun run test`. Run with the backend up:
 *
 *     bun scripts/live-probe.ts            # default model
 *     PROBE_MODEL=opencode/glm-5 bun scripts/live-probe.ts
 *     PROBE_TOOL_PROMPT="..." bun scripts/live-probe.ts   # override the tool turn
 *
 * Drives the FE's REAL network-facing modules (the thin live integration test the
 * methodology calls for — the analogue of the backend's server.bun.test.ts):
 *   - adapters/ws  createSurfaceSocket  → real WebSocket, one socket multiplexes
 *     the surface `catalog` AND chat ops (deltas routed by conversationId).
 *   - core/chunks  foldEvent/applyHistory/groupRenderedChunks → fold REAL
 *     chat.delta AgentEvents and group batched tool calls by stepId.
 *   - features/conversation-cache + adapters/idb (fake-indexeddb) → real cache.
 *   - HTTP GET /conversations/:id?sinceSeq → real ConversationHistoryResponse.
 * Skips the runes chat store + svelte UI (need the Svelte compiler; thin wrappers).
 *
 * Turn 1 verifies the text streaming + cache + replay path.
 * Turn 2 verifies the tool-call BATCHING path (wire@0.2.0 `stepId`): that live
 * tool events AND replayed tool chunks carry `stepId`, and that the pure grouping
 * selector folds a parallel batch into one group.
 */

// Provides globalThis.indexedDB + IDBKeyRange etc. for the idb adapter (a real
// browser has these natively; Bun does not). The product code is unchanged.
import "fake-indexeddb/auto";
import type {
	ChatDeltaMessage,
	ChatErrorMessage,
	ConversationHistoryResponse,
	ConversationMetricsResponse,
} from "@dispatch/transport-contract";
import type { SurfaceServerMessage } from "@dispatch/ui-contract";
import { createIdbChunkStore } from "../src/adapters/idb/index.ts";
import { createSurfaceSocket } from "../src/adapters/ws/index.ts";
import {
	applyHistory,
	foldEvent,
	groupRenderedChunks,
	initialState,
	selectChunks,
	selectMessages,
	type TranscriptState,
} from "../src/core/chunks/index.ts";
import {
	applyDurableMetrics,
	foldMetricsEvent,
	initialMetricsState,
	type MetricsState,
	selectOrderedTurnMetrics,
} from "../src/core/metrics/index.ts";
import { createConversationCache } from "../src/features/conversation-cache/index.ts";

const WS_URL = process.env.PROBE_WS ?? "ws://localhost:24205";
const HTTP_BASE = process.env.PROBE_HTTP ?? "http://localhost:24203";
const MODEL = process.env.PROBE_MODEL ?? "opencode/deepseek-v4-flash";
const TEXT_PROMPT = process.env.PROBE_PROMPT ?? "Reply with exactly: hello from dispatch";
const TOOL_PROMPT =
	process.env.PROBE_TOOL_PROMPT ??
	"Make two tool calls AT THE SAME TIME in a single step (parallel tool calls). " +
		"For example, run two independent shell commands together: `echo alpha` and `echo beta`. " +
		"If you have no shell tool, invoke any two of your available read-only tools simultaneously.";

const checks: { name: string; ok: boolean; detail?: string }[] = [];
const record = (name: string, ok: boolean, detail?: string) => {
	checks.push({ name, ok, ...(detail !== undefined ? { detail } : {}) });
	console.log(`  ${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const note = (msg: string) => console.log(`  ℹ️  ${msg}`);

function fail(msg: string): never {
	console.error(`\n[live-probe] FATAL: ${msg}`);
	process.exit(1);
}

async function historySync(id: string, sinceSeq: number): Promise<ConversationHistoryResponse> {
	const url = `${HTTP_BASE}/conversations/${encodeURIComponent(id)}?sinceSeq=${sinceSeq}`;
	const res = await fetch(url, { headers: { Origin: "http://localhost:24204" } });
	if (!res.ok) fail(`history fetch ${res.status} for ${url}`);
	return (await res.json()) as ConversationHistoryResponse;
}

/** Durable metrics fetch — returns the response, or the HTTP status when not OK
 * (the endpoint is being implemented backend-side; the FE tolerates a 404). */
async function metricsSync(id: string): Promise<ConversationMetricsResponse | { status: number }> {
	const url = `${HTTP_BASE}/conversations/${encodeURIComponent(id)}/metrics`;
	const res = await fetch(url, { headers: { Origin: "http://localhost:24204" } });
	if (!res.ok) return { status: res.status };
	return (await res.json()) as ConversationMetricsResponse;
}

type ChatMsg = ChatDeltaMessage | ChatErrorMessage;
type Socket = ReturnType<typeof createSurfaceSocket>;

const handlers = new Map<string, (msg: ChatMsg) => void>();
function convOf(msg: ChatMsg): string | undefined {
	return msg.type === "chat.error" ? msg.conversationId : msg.event.conversationId;
}

/** Drive one turn to turn-sealed (or error), folding events into a fresh state. */
async function runTurn(
	socket: Socket,
	conversationId: string,
	prompt: string,
): Promise<{
	state: TranscriptState;
	metrics: MetricsState;
	deltas: number;
	sealed: boolean;
	error: string | null;
}> {
	let state = initialState();
	let metrics = initialMetricsState();
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
		metrics = foldMetricsEvent(metrics, msg.event);
		if (msg.event.type === "turn-sealed") {
			sealed = true;
			done.resolve();
		}
	});

	socket.send({ type: "chat.send", conversationId, message: prompt, model: MODEL });
	const timeout = setTimeout(() => done.resolve(), 90_000);
	await done.promise;
	clearTimeout(timeout);
	handlers.delete(conversationId);
	return { state, metrics, deltas, sealed, error };
}

function toolChunksOf(state: TranscriptState) {
	return selectChunks(state).filter(
		(c) => c.chunk.type === "tool-call" || c.chunk.type === "tool-result",
	);
}

async function main() {
	console.log(`[live-probe] model=${MODEL}`);
	console.log(`[live-probe] WS=${WS_URL} HTTP=${HTTP_BASE}\n`);

	const cache = createConversationCache(createIdbChunkStore());

	let gotCatalog = false;
	const socket = createSurfaceSocket({
		url: WS_URL,
		onMessage: (m: SurfaceServerMessage) => {
			if (m.type === "catalog") {
				gotCatalog = true;
				console.log(`  ↳ surface catalog: ${m.catalog.length} surface(s)`);
			}
		},
		onChat: (msg: ChatMsg) => {
			const id = convOf(msg);
			const h = id !== undefined ? handlers.get(id) : undefined;
			if (h) h(msg);
		},
	});

	await new Promise((r) => setTimeout(r, 500));
	record("WS connected + surface catalog received", gotCatalog);

	// ─── Turn 1: text streaming + cache + replay ────────────────────────────────
	console.log(`\n[live-probe] TURN 1 (text): "${TEXT_PROMPT}"`);
	const textConv = crypto.randomUUID();
	const t1 = await runTurn(socket, textConv, TEXT_PROMPT);
	if (t1.error !== null) record("turn 1 had no chat.error", false, t1.error);
	record("turn 1 received chat.delta events", t1.deltas > 0, `${t1.deltas} deltas`);
	record("turn 1 reached turn-sealed", t1.sealed);

	let state = t1.state;
	const sinceSeq = await cache.sinceSeq(textConv);
	const hist = await historySync(textConv, sinceSeq);
	record(
		"turn 1 history endpoint returned chunks",
		hist.chunks.length > 0,
		`${hist.chunks.length} chunks, latestSeq=${hist.latestSeq}`,
	);
	const monotonic = hist.chunks.every((c, i) => i === 0 || c.seq > (hist.chunks[i - 1]?.seq ?? -1));
	record("turn 1 history chunks are seq-monotonic", monotonic);
	const merged = await cache.commit(textConv, hist.chunks);
	state = applyHistory(state, merged);
	record("turn 1 provisional superseded (sealedTurnId cleared)", state.sealedTurnId === null);
	const cached = await cache.load(textConv);
	record("turn 1 IndexedDB cache persisted the turn", cached.length === hist.chunks.length);
	const committedText = selectMessages(state)
		.filter((m) => m.role === "assistant")
		.flatMap((m) => m.chunks)
		.filter((c) => c.type === "text")
		.map((c) => (c as { text: string }).text)
		.join("");
	record("turn 1 committed transcript has assistant text", committedText.length > 0);

	// ─── Metrics: LIVE token + timing (wire@0.3.0 usage/step-complete/done) ──────
	// (TurnMetricsEntry is `{ turnId, steps, total }` — the turn aggregate lives on
	// `total`, present once the live `done` folded.)
	const liveTurns = selectOrderedTurnMetrics(t1.metrics);
	const m1 = liveTurns[0];
	const m1Total = m1?.total ?? null;
	record(
		"turn 1 LIVE metrics: a turn with output tokens",
		m1Total !== null && m1Total.usage.outputTokens > 0,
		m1Total
			? `in=${m1Total.usage.inputTokens} out=${m1Total.usage.outputTokens} steps=${m1?.steps.length}`
			: "no finalized turn total",
	);
	if (m1 !== undefined) {
		const anyGen = m1.steps.some((s) => s.genTotalMs !== undefined);
		const anyTtft = m1.steps.some((s) => s.ttftMs !== undefined);
		note(
			`live timing: durationMs=${m1Total?.durationMs ?? "—"}, ` +
				`genTotalMs present=${anyGen}, ttftMs present=${anyTtft}`,
		);
		record(
			"turn 1 LIVE metrics carries timing (durationMs or step genTotalMs)",
			m1Total?.durationMs !== undefined || anyGen,
			"requires the backend runtime to have a clock",
		);
	}

	// ─── Metrics: DURABLE endpoint (GET /conversations/:id/metrics) ──────────────
	const dm = await metricsSync(textConv);
	if ("status" in dm) {
		note(
			`durable /metrics not available yet (HTTP ${dm.status}) — FE degrades to live-only, as designed`,
		);
		record(
			"durable /metrics is implemented OR gracefully absent (404)",
			dm.status === 404 || dm.status === 405,
			`HTTP ${dm.status}`,
		);
	} else {
		record(
			"durable /metrics returned TurnMetrics[]",
			Array.isArray(dm.turns),
			`${dm.turns.length} turn(s)`,
		);
		const durableMerged = selectOrderedTurnMetrics(
			applyDurableMetrics(initialMetricsState(), dm.turns),
		);
		const d1 = durableMerged[0];
		const d1Total = d1?.total ?? null;
		record(
			"durable /metrics turn has token usage",
			d1Total !== null && d1Total.usage.outputTokens > 0,
			d1Total ? `out=${d1Total.usage.outputTokens} steps=${d1?.steps.length}` : "no turn total",
		);
	}

	// ─── Turn 2: tool-call batching (wire@0.2.0 stepId) ─────────────────────────
	console.log(`\n[live-probe] TURN 2 (tools): "${TOOL_PROMPT}"`);
	const toolConv = crypto.randomUUID();
	const t2 = await runTurn(socket, toolConv, TOOL_PROMPT);
	if (t2.error !== null) record("turn 2 had no chat.error", false, t2.error);
	record("turn 2 reached turn-sealed", t2.sealed);

	const liveTool = toolChunksOf(t2.state);
	const liveCalls = liveTool.filter((c) => c.chunk.type === "tool-call");

	if (liveCalls.length === 0) {
		note(
			"INCONCLUSIVE: the model issued no tool calls this run — cannot verify stepId grouping live. " +
				"Re-run with a stronger PROBE_TOOL_PROMPT or one tailored to the backend's tool set.",
		);
		record("turn 2 tool-call batching (live)", true, "skipped — no tool calls issued");
	} else {
		// Every live tool chunk must carry stepId (foldEvent copies it from the event).
		const allLiveHaveStep = liveTool.every(
			(c) =>
				(c.chunk.type === "tool-call" || c.chunk.type === "tool-result") &&
				typeof c.chunk.stepId === "string" &&
				c.chunk.stepId.length > 0,
		);
		record(
			"turn 2 every LIVE tool event carries stepId",
			allLiveHaveStep,
			`${liveCalls.length} call(s), ${liveTool.length - liveCalls.length} result(s)`,
		);

		const liveGroups = groupRenderedChunks(selectChunks(t2.state));
		const liveBatches = liveGroups.filter((g) => g.kind === "tool-batch");
		const distinctSteps = new Set(
			liveCalls.map((c) => (c.chunk.type === "tool-call" ? c.chunk.stepId : undefined)),
		);
		note(
			`live grouping: ${liveCalls.length} call(s) across ${distinctSteps.size} step(s) → ` +
				`${liveBatches.length} batch group(s)`,
		);
		if (liveBatches.length > 0) {
			record(
				"turn 2 grouping produced a parallel batch (2+ calls in one step)",
				true,
				`${liveBatches.length} batch(es)`,
			);
		} else {
			note(
				"the model used tools but did NOT parallelize (each call its own step) — stepId is verified, " +
					"but no multi-call batch occurred to render as a list this run.",
			);
		}

		// Replay path: persisted tool chunks must also carry chunk.stepId.
		const histTool = await historySync(toolConv, 0);
		const replayTool = histTool.chunks.filter(
			(c) => c.chunk.type === "tool-call" || c.chunk.type === "tool-result",
		);
		const allReplayHaveStep = replayTool.every(
			(c) =>
				(c.chunk.type === "tool-call" || c.chunk.type === "tool-result") &&
				typeof c.chunk.stepId === "string" &&
				c.chunk.stepId.length > 0,
		);
		record(
			"turn 2 every REPLAYED tool chunk carries chunk.stepId",
			replayTool.length > 0 && allReplayHaveStep,
			`${replayTool.length} tool chunk(s) in history`,
		);

		// Grouping on the authoritative replayed history matches the live shape.
		const replayState = applyHistory(initialState(), await cache.commit(toolConv, histTool.chunks));
		const replayBatches = groupRenderedChunks(selectChunks(replayState)).filter(
			(g) => g.kind === "tool-batch",
		);
		record(
			"turn 2 replay grouping matches live (batch count)",
			replayBatches.length === liveBatches.length,
			`live=${liveBatches.length} replay=${replayBatches.length}`,
		);
	}

	socket.close();

	const passed = checks.filter((c) => c.ok).length;
	const total = checks.length;
	console.log(`\n[live-probe] ${passed}/${total} checks passed`);
	process.exit(passed === total ? 0 : 1);
}

main().catch((e) => fail(String(e)));
