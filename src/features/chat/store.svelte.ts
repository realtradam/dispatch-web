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
	foldEvent,
	initialState,
	selectChunks,
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
	readonly pendingSync: boolean;
	readonly error: string | null;
	readonly model: string | undefined;
	handleDelta(msg: ChatDeltaMessage | ChatErrorMessage): void;
	send(text: string): void;
	setModel(model: string): void;
	load(): Promise<void>;
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

		dispose(): void {
			disposed = true;
		},
	};
}
