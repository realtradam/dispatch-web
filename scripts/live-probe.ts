/**
 * scripts/live-probe.ts — LIVE end-to-end probe of the FE chat path against a
 * RUNNING backend (bin/up: HTTP :24203 + surface WS :24205). NOT part of
 * `bun run test`. Run with the backend up:
 *
 *     bun scripts/live-probe.ts            # default model
 *     PROBE_MODEL=opencode/glm-5 bun scripts/live-probe.ts
 *
 * Drives the FE's REAL network-facing modules (the thin live integration test the
 * methodology calls for — the analogue of the backend's server.bun.test.ts):
 *   - adapters/ws  createSurfaceSocket  → real WebSocket, one socket multiplexes
 *     the surface `catalog` AND chat ops.
 *   - core/chunks  foldEvent/applyHistory → fold REAL chat.delta AgentEvents.
 *   - features/conversation-cache + adapters/idb (fake-indexeddb) → real cache.
 *   - HTTP GET /conversations/:id?sinceSeq → real ConversationHistoryResponse.
 * Skips the runes chat store + svelte UI (need the Svelte compiler; thin wrappers).
 */

// Provides globalThis.indexedDB + IDBKeyRange etc. for the idb adapter (a real
// browser has these natively; Bun does not). The product code is unchanged.
import "fake-indexeddb/auto";
import type {
	ChatDeltaMessage,
	ChatErrorMessage,
	ConversationHistoryResponse,
} from "@dispatch/transport-contract";
import type { SurfaceServerMessage } from "@dispatch/ui-contract";
import { createIdbChunkStore } from "../src/adapters/idb/index.ts";
import { createSurfaceSocket } from "../src/adapters/ws/index.ts";
import { applyHistory, foldEvent, initialState, selectMessages } from "../src/core/chunks/index.ts";
import { createConversationCache } from "../src/features/conversation-cache/index.ts";

const WS_URL = process.env.PROBE_WS ?? "ws://localhost:24205";
const HTTP_BASE = process.env.PROBE_HTTP ?? "http://localhost:24203";
const MODEL = process.env.PROBE_MODEL ?? "opencode/deepseek-v4-flash";
const PROMPT = process.env.PROBE_PROMPT ?? "Reply with exactly: hello from dispatch";
const conversationId = crypto.randomUUID();

const checks: { name: string; ok: boolean; detail?: string }[] = [];
const record = (name: string, ok: boolean, detail?: string) => {
	checks.push({ name, ok, ...(detail !== undefined ? { detail } : {}) });
	console.log(`  ${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
};

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

async function main() {
	console.log(`[live-probe] conversation=${conversationId} model=${MODEL}`);
	console.log(`[live-probe] WS=${WS_URL} HTTP=${HTTP_BASE}\n`);

	const cache = createConversationCache(createIdbChunkStore());

	let state = initialState();
	let gotCatalog = false;
	let deltaCount = 0;
	let sawTextDelta = false;
	let sawSeal = false;
	const done = Promise.withResolvers<void>();

	const onChat = (msg: ChatDeltaMessage | ChatErrorMessage) => {
		if (msg.type === "chat.error") {
			record("no chat.error", false, msg.message);
			done.resolve();
			return;
		}
		deltaCount++;
		if (msg.event.type === "text-delta") sawTextDelta = true;
		state = foldEvent(state, msg.event);
		if (msg.event.type === "turn-sealed") {
			sawSeal = true;
			done.resolve();
		}
	};

	const socket = createSurfaceSocket({
		url: WS_URL,
		onMessage: (m: SurfaceServerMessage) => {
			if (m.type === "catalog") {
				gotCatalog = true;
				console.log(`  ↳ surface catalog: ${m.catalog.length} surface(s)`);
			}
		},
		onChat,
	});

	// Give the socket a moment to open + deliver the catalog, then send the turn.
	await new Promise((r) => setTimeout(r, 500));
	record("WS connected + surface catalog received", gotCatalog);

	console.log(`\n[live-probe] sending chat.send: "${PROMPT}"`);
	socket.send({ type: "chat.send", conversationId, message: PROMPT, model: MODEL });

	// Wait for turn-sealed (or error), with a hard timeout.
	const timeout = setTimeout(() => done.resolve(), 90_000);
	await done.promise;
	clearTimeout(timeout);

	record("received chat.delta events", deltaCount > 0, `${deltaCount} deltas`);
	record("saw text-delta", sawTextDelta);
	record("turn reached turn-sealed", sawSeal);

	const provisionalText = selectMessages(state)
		.flatMap((m) => m.chunks)
		.filter((c) => c.type === "text")
		.map((c) => (c as { text: string }).text)
		.join("");
	console.log(`\n  ↳ streamed assistant text (provisional): ${JSON.stringify(provisionalText)}`);

	// Post-seal: resync authoritative seq'd history + commit to cache (the real path).
	const sinceSeq = await cache.sinceSeq(conversationId);
	const hist = await historySync(conversationId, sinceSeq);
	record("history endpoint returned chunks", hist.chunks.length > 0, `${hist.chunks.length} chunks, latestSeq=${hist.latestSeq}`);
	const monotonic = hist.chunks.every((c, i) => i === 0 || c.seq > (hist.chunks[i - 1]?.seq ?? -1));
	record("history chunks are seq-monotonic", monotonic);

	const merged = await cache.commit(conversationId, hist.chunks);
	state = applyHistory(state, merged);
	record("provisional superseded after applyHistory (sealedTurnId cleared)", state.sealedTurnId === null);

	const cached = await cache.load(conversationId);
	record("IndexedDB cache persisted the turn", cached.length === hist.chunks.length, `${cached.length} cached`);

	const committedText = selectMessages(state)
		.filter((m) => m.role === "assistant")
		.flatMap((m) => m.chunks)
		.filter((c) => c.type === "text")
		.map((c) => (c as { text: string }).text)
		.join("");
	console.log(`  ↳ committed assistant text (post-sync): ${JSON.stringify(committedText)}`);
	record("committed transcript has assistant text", committedText.length > 0);

	socket.close();

	const passed = checks.filter((c) => c.ok).length;
	const total = checks.length;
	console.log(`\n[live-probe] ${passed}/${total} checks passed`);
	process.exit(passed === total ? 0 : 1);
}

main().catch((e) => fail(String(e)));
