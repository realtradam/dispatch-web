import type {
	ChatDeltaMessage,
	ChatErrorMessage,
	ChatSendMessage,
} from "@dispatch/transport-contract";
import type { ChatMessage } from "@dispatch/wire";
import type { RenderedChunk, TranscriptState } from "../../core/chunks";
import {
	appendUserMessage,
	applyHistory,
	clearGenerating,
	foldEvent,
	initialState,
	selectChunks,
	selectGenerating,
	selectMessages,
} from "../../core/chunks";
import type { MetricsState, TurnMetricsEntry } from "../../core/metrics";
import {
	applyDurableMetrics,
	foldMetricsEvent,
	initialMetricsState,
	selectCurrentContextSize,
	selectOrderedTurnMetrics,
} from "../../core/metrics";
import type { ConversationCache } from "../conversation-cache";
import type { ChatTransport, HistorySync, MetricsSync } from "./ports";

export interface ChatStoreDependencies {
	readonly conversationId: string;
	readonly model?: string;
	readonly transport: ChatTransport;
	readonly historySync: HistorySync;
	readonly metricsSync: MetricsSync;
	readonly cache: ConversationCache;
}

export interface ChatStore {
	readonly messages: readonly ChatMessage[];
	readonly chunks: readonly RenderedChunk[];
	readonly turnMetrics: readonly TurnMetricsEntry[];
	/**
	 * The conversation's current context size (tokens occupied) — the latest
	 * finalized turn's `contextSize`, or `undefined` ("unknown") when none is
	 * known yet. Never `0` for the unknown case.
	 */
	readonly currentContextSize: number | undefined;
	/**
	 * Whether a turn is currently generating server-side — derived from the event
	 * stream (`turn-start`…no-`done`/`turn-sealed`-yet). True for ANY watching
	 * client: the sender, a second device, or a reconnected client whose in-flight
	 * turn was replayed. Drives the composer's "generating…" indicator.
	 */
	readonly generating: boolean;
	readonly pendingSync: boolean;
	readonly error: string | null;
	readonly model: string | undefined;
	handleDelta(msg: ChatDeltaMessage | ChatErrorMessage): void;
	send(text: string): void;
	setModel(model: string): void;
	load(): Promise<void>;
	/**
	 * Re-sync after a WS (re)connect. Clears any stale `generating` (a turn may
	 * have sealed while disconnected — the live `turn-sealed` was missed), then
	 * pulls newly-sealed turns from history (+ metrics). If the turn is still
	 * running, the server's post-subscribe replay re-asserts `generating`. The
	 * app store pairs this with a `chat.subscribe` for the conversation.
	 */
	resync(): void;
	dispose(): void;
}

export function createChatStore(deps: ChatStoreDependencies): ChatStore {
	let transcript = $state<TranscriptState>(initialState());
	let metrics = $state<MetricsState>(initialMetricsState());
	let _pendingSync = $state(false);
	let _error = $state<string | null>(null);
	let _model = $state<string | undefined>(deps.model);
	let disposed = false;

	async function syncTail(): Promise<void> {
		if (disposed || _pendingSync) return;
		_pendingSync = true;
		try {
			const since = await deps.cache.sinceSeq(deps.conversationId);
			const res = await deps.historySync(deps.conversationId, since);
			const merged = await deps.cache.commit(deps.conversationId, res.chunks);
			transcript = applyHistory(transcript, merged);
			_error = null;
		} catch (err) {
			_error = err instanceof Error ? err.message : String(err);
		} finally {
			_pendingSync = false;
		}
	}

	async function syncMetrics(): Promise<void> {
		if (disposed) return;
		try {
			const res = await deps.metricsSync(deps.conversationId);
			metrics = applyDurableMetrics(metrics, res.turns);
		} catch {
			// Metrics fetch failure must not block history sync or throw;
			// live-folded metrics remain intact.
		}
	}

	return {
		get messages(): readonly ChatMessage[] {
			return selectMessages(transcript);
		},
		get chunks(): readonly RenderedChunk[] {
			return selectChunks(transcript);
		},
		get turnMetrics(): readonly TurnMetricsEntry[] {
			return selectOrderedTurnMetrics(metrics);
		},
		get currentContextSize(): number | undefined {
			return selectCurrentContextSize(metrics);
		},
		get generating(): boolean {
			return selectGenerating(transcript);
		},
		get pendingSync(): boolean {
			return _pendingSync;
		},
		get error(): string | null {
			return _error;
		},
		get model(): string | undefined {
			return _model;
		},

		handleDelta(msg: ChatDeltaMessage | ChatErrorMessage): void {
			if (msg.type === "chat.error") {
				if (msg.conversationId !== undefined && msg.conversationId !== deps.conversationId) {
					return;
				}
				_error = msg.message;
				return;
			}
			if (msg.event.conversationId !== deps.conversationId) {
				return;
			}
			transcript = foldEvent(transcript, msg.event);
			metrics = foldMetricsEvent(metrics, msg.event);
			if (transcript.sealedTurnId !== null) {
				void syncTail();
				void syncMetrics();
			}
		},

		send(text: string): void {
			transcript = appendUserMessage(transcript, text);
			const msg: ChatSendMessage = {
				type: "chat.send",
				conversationId: deps.conversationId,
				message: text,
				...(_model !== undefined ? { model: _model } : {}),
			};
			deps.transport.send(msg);
		},

		setModel(model: string): void {
			_model = model;
		},

		async load(): Promise<void> {
			const cached = await deps.cache.load(deps.conversationId);
			if (cached.length > 0) {
				transcript = applyHistory(transcript, cached);
			}
			await syncTail();
			await syncMetrics();
		},

		resync(): void {
			if (disposed) return;
			// A turn may have sealed while we were disconnected (missed `turn-sealed`):
			// clear the now-stale spinner BEFORE re-subscribing, so a finished turn
			// doesn't spin forever. A still-running turn's replay re-asserts it.
			transcript = clearGenerating(transcript);
			void syncTail();
			void syncMetrics();
		},

		dispose(): void {
			disposed = true;
		},
	};
}
