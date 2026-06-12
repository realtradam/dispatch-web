/**
 * scripts/probe-cache-warming.ts — LIVE probe of the `cache-warming` surface +
 * conversation-close lifecycle against a RUNNING backend (bin/up: HTTP :24203 +
 * surface WS :24205; override with PROBE_HTTP / PROBE_WS for bin/up2's +1000
 * ports). NOT part of `bun run test`. Verifies the CR-4 handoff end-to-end:
 *
 *   A. draft subscribe (no conversationId) → degenerate "no conversation" spec
 *   B. fresh conversation → warming defaults OFF, nothing scheduled (CR-4a)
 *   C. toggle on + 10s interval → repeated automatic warms, each update carrying
 *      a FUTURE nextWarmAt (CR-4b), initial `surface` echoes conversationId (CR-4d)
 *   D. POST /conversations/:id/close mid-turn → abortedTurn, done.reason
 *      "aborted", turn-sealed, warming disabled + unscheduled (CR-4c)
 *
 *     bun scripts/probe-cache-warming.ts
 */
import type {
	ChatDeltaMessage,
	ChatErrorMessage,
	CloseConversationResponse,
} from "@dispatch/transport-contract";
import type { SurfaceServerMessage, SurfaceSpec } from "@dispatch/ui-contract";
import { createSurfaceSocket } from "../src/adapters/ws/index.ts";
import { parseControls } from "../src/features/cache-warming/logic/view-model.ts";

const WS_URL = process.env.PROBE_WS ?? "ws://localhost:24205";
const HTTP_BASE = process.env.PROBE_HTTP ?? "http://localhost:24203";
const SURFACE_ID = "cache-warming";

const checks: { name: string; ok: boolean }[] = [];
const record = (name: string, ok: boolean, detail?: string) => {
	checks.push({ name, ok });
	console.log(`  ${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const log = (msg: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function summarize(spec: SurfaceSpec | null): string {
	const c = parseControls(spec);
	const next =
		c.nextWarmAt === null ? "null" : `${Math.round((c.nextWarmAt - Date.now()) / 1000)}s`;
	return `enabled=${c.enabled} interval=${c.intervalSeconds}s lastPct=${c.lastPct} next=${next} lastWarmAt=${c.lastWarmAt}`;
}

let catalog: { id: string; scope?: string }[] = [];
let latestSpec: SurfaceSpec | null = null;
let latestSpecConv: string | undefined;
let specWaiter: (() => void) | null = null;

const chatHandlers = new Map<string, (msg: ChatDeltaMessage | ChatErrorMessage) => void>();

const socket = createSurfaceSocket({
	url: WS_URL,
	onMessage: (m: SurfaceServerMessage) => {
		if (m.type === "catalog") {
			catalog = [...m.catalog];
			log(`catalog: ${m.catalog.map((e) => `${e.id}(scope=${e.scope ?? "—"})`).join(", ")}`);
		} else if (m.type === "surface") {
			latestSpec = m.spec;
			latestSpecConv = m.conversationId;
			log(`surface(initial) conv=${m.conversationId ?? "—"}: ${summarize(m.spec)}`);
			specWaiter?.();
		} else if (m.type === "update") {
			if (m.update.surfaceId !== SURFACE_ID) return;
			latestSpec = m.update.spec;
			latestSpecConv = m.update.conversationId;
			log(`update conv=${m.update.conversationId ?? "—"}: ${summarize(m.update.spec)}`);
			specWaiter?.();
		} else if (m.type === "error") {
			log(`surface ERROR: ${m.surfaceId ?? "—"}: ${m.message}`);
		}
	},
	onChat: (msg) => {
		const id = msg.type === "chat.error" ? msg.conversationId : msg.event.conversationId;
		if (id !== undefined) chatHandlers.get(id)?.(msg);
	},
});

/** Wait for the next surface/update message (or time out). */
function nextSpec(timeoutMs: number): Promise<boolean> {
	return new Promise((resolve) => {
		const t = setTimeout(() => {
			specWaiter = null;
			resolve(false);
		}, timeoutMs);
		specWaiter = () => {
			clearTimeout(t);
			specWaiter = null;
			resolve(true);
		};
	});
}

async function runTinyTurn(conversationId: string, prompt: string): Promise<boolean> {
	const done = Promise.withResolvers<boolean>();
	chatHandlers.set(conversationId, (msg) => {
		if (msg.type === "chat.error") {
			log(`chat.error: ${msg.message}`);
			done.resolve(false);
		} else if (msg.event.type === "turn-sealed") {
			done.resolve(true);
		}
	});
	socket.send({ type: "chat.send", conversationId, message: prompt });
	const t = setTimeout(() => done.resolve(false), 90_000);
	const ok = await done.promise;
	clearTimeout(t);
	chatHandlers.delete(conversationId);
	return ok;
}

function invoke(actionId: string, conversationId: string, payload?: unknown): void {
	socket.send(
		payload === undefined
			? { type: "invoke", surfaceId: SURFACE_ID, actionId, conversationId }
			: { type: "invoke", surfaceId: SURFACE_ID, actionId, payload, conversationId },
	);
}

async function main() {
	await sleep(600);
	record(
		"catalog includes cache-warming with scope=conversation",
		catalog.some((e) => e.id === SURFACE_ID && e.scope === "conversation"),
	);

	// ── A: the DRAFT/new-tab path — subscribe with NO conversationId ───────────
	log("PHASE A: subscribe with NO conversationId (draft / new tab)");
	socket.send({ type: "subscribe", surfaceId: SURFACE_ID });
	await nextSpec(3000);
	record(
		"draft subscribe → degenerate spec (no toggle parsed)",
		!parseControls(latestSpec).enabled,
	);
	socket.send({ type: "unsubscribe", surfaceId: SURFACE_ID });
	await sleep(300);

	// ── B: a FRESH conversation defaults OFF (CR-4a) + echo (CR-4d) ────────────
	const conv = crypto.randomUUID();
	log(`PHASE B: creating conversation ${conv}`);
	if (!(await runTinyTurn(conv, "Reply with exactly: ok"))) {
		log("FATAL: could not create a conversation");
		process.exit(1);
	}
	socket.send({ type: "subscribe", surfaceId: SURFACE_ID, conversationId: conv });
	await nextSpec(3000);
	const fresh = parseControls(latestSpec);
	record("CR-4d: initial surface message echoes conversationId", latestSpecConv === conv);
	record("CR-4a: fresh conversation defaults to warming OFF", fresh.enabled === false);
	record("CR-4a: nothing scheduled while off (nextWarmAt null)", fresh.nextWarmAt === null);

	// ── C: opt in + 10s interval → repeated warms, FUTURE nextWarmAt (CR-4b) ───
	log("PHASE C: toggling warming ON");
	const toggleId = fresh.toggleActionId;
	if (toggleId === null) {
		record("toggle action present", false);
		process.exit(1);
	}
	invoke(toggleId, conv);
	await nextSpec(3000);
	let c = parseControls(latestSpec);
	record("toggle-on update arrived (enabled)", c.enabled === true);
	record(
		"CR-4b: enable schedules a FUTURE nextWarmAt",
		c.nextWarmAt !== null && c.nextWarmAt > Date.now(),
	);

	const setIntervalId = c.setIntervalActionId;
	if (setIntervalId !== null) {
		log("PHASE C: set-interval = 10s");
		invoke(setIntervalId, conv, 10);
		await nextSpec(3000);
		c = parseControls(latestSpec);
		record(
			"set-interval update: interval=10 + FUTURE nextWarmAt",
			c.intervalSeconds === 10 && c.nextWarmAt !== null && c.nextWarmAt > Date.now(),
		);
	}

	log("PHASE C: waiting up to 45s for 2 automatic warms…");
	const deadline = Date.now() + 45_000;
	let lastSeen = c.lastWarmAt;
	let warms = 0;
	let allFuture = true;
	while (Date.now() < deadline && warms < 2) {
		await nextSpec(Math.max(1, deadline - Date.now()));
		const now = parseControls(latestSpec);
		if (now.lastWarmAt !== null && now.lastWarmAt !== lastSeen) {
			lastSeen = now.lastWarmAt;
			warms++;
			const future = now.nextWarmAt !== null && now.nextWarmAt > Date.now() - 1000;
			if (!future) allFuture = false;
			log(
				`  automatic warm #${warms}: pct=${now.lastPct} retention=${now.retentionPct} ` +
					`nextWarmAt ${future ? "FUTURE" : "STALE/PAST"}`,
			);
		}
	}
	record("automatic warms repeat (2 observed @10s)", warms >= 2, `${warms} warm(s)`);
	record("CR-4b: every post-warm update carries a FUTURE nextWarmAt", warms >= 2 && allFuture);

	// ── D: close mid-turn → abort + warming disabled (CR-4c) ───────────────────
	log("PHASE D: starting a long turn, then closing the conversation mid-turn…");
	const seenDone = Promise.withResolvers<string>(); // resolves with done.reason
	const seenSealed = Promise.withResolvers<void>();
	let turnStarted = false;
	const started = Promise.withResolvers<void>();
	chatHandlers.set(conv, (msg) => {
		if (msg.type === "chat.error") {
			log(`chat.error: ${msg.message}`);
			return;
		}
		const ev = msg.event;
		if (ev.type === "turn-start") {
			turnStarted = true;
			started.resolve();
		} else if (ev.type === "done") {
			seenDone.resolve(ev.reason);
		} else if (ev.type === "turn-sealed") {
			seenSealed.resolve();
		}
	});
	socket.send({
		type: "chat.send",
		conversationId: conv,
		message:
			"Write a detailed 1000-word essay about the history of computing. Take your time and be thorough.",
	});
	const startTimeout = setTimeout(() => started.resolve(), 15_000);
	await started.promise;
	clearTimeout(startTimeout);
	record("turn started (watcher saw turn-start)", turnStarted);
	await sleep(1000); // let it generate a moment

	const res = await fetch(`${HTTP_BASE}/conversations/${encodeURIComponent(conv)}/close`, {
		method: "POST",
		headers: { Origin: "http://localhost:24204" },
	});
	record("POST /conversations/:id/close → 200", res.ok, `HTTP ${res.status}`);
	const body = (await res.json()) as CloseConversationResponse;
	record("close aborted the in-flight turn (abortedTurn)", body.abortedTurn === true);

	const doneReason = await Promise.race([seenDone.promise, sleep(15_000).then(() => "(timeout)")]);
	record('watcher received done with reason "aborted"', doneReason === "aborted", doneReason);
	const sealed = await Promise.race([
		seenSealed.promise.then(() => true),
		sleep(15_000).then(() => false),
	]);
	record("turn sealed normally after abort", sealed);
	chatHandlers.delete(conv);

	// The close also pushed a surface update: warming disabled + unscheduled.
	await sleep(1500);
	const closed = parseControls(latestSpec);
	record(
		"CR-4c: close disabled warming + cleared the schedule",
		closed.enabled === false && closed.nextWarmAt === null,
		summarize(latestSpec),
	);

	// Idempotency: closing again (now idle) succeeds with abortedTurn false.
	const res2 = await fetch(`${HTTP_BASE}/conversations/${encodeURIComponent(conv)}/close`, {
		method: "POST",
		headers: { Origin: "http://localhost:24204" },
	});
	const body2 = (await res2.json()) as CloseConversationResponse;
	record("close is idempotent (200 + abortedTurn:false)", res2.ok && body2.abortedTurn === false);

	socket.close();
	const passed = checks.filter((x) => x.ok).length;
	console.log(`\n[probe-cache-warming] ${passed}/${checks.length} checks passed`);
	process.exit(passed === checks.length ? 0 : 1);
}

main().catch((e) => {
	console.error(`[probe] FATAL: ${e}`);
	process.exit(1);
});
