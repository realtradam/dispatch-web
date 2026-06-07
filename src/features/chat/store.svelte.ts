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
import type { TelemetryState } from "../../core/telemetry";
import { foldMetricEvent, initialState as telemetryInitialState } from "../../core/telemetry";
import type { ConversationCache } from "../conversation-cache";
import type { ChatTransport, HistorySync } from "./ports";

export interface ChatStoreDependencies {
	readonly conversationId: string;
	readonly model?: string;
	readonly transport: ChatTransport;
	readonly historySync: HistorySync;
	readonly cache: ConversationCache;
}

export interface ChatStore {
	readonly messages: readonly ChatMessage[];
	readonly chunks: readonly RenderedChunk[];
	readonly pendingSync: boolean;
	readonly error: string | null;
	readonly model: string | undefined;
	readonly telemetry: TelemetryState;
	readonly currentTurnId: string | null;
	handleDelta(msg: ChatDeltaMessage | ChatErrorMessage): void;
	send(text: string): void;
	setModel(model: string): void;
	load(): Promise<void>;
	dispose(): void;
}

export function createChatStore(deps: ChatStoreDependencies): ChatStore {
	let transcript = $state<TranscriptState>(initialState());
	let _pendingSync = $state(false);
	let _error = $state<string | null>(null);
	let _model = $state<string | undefined>(deps.model);
	let telemetry = $state<TelemetryState>(telemetryInitialState());
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

	return {
		get messages(): readonly ChatMessage[] {
			return selectMessages(transcript);
		},
		get chunks(): readonly RenderedChunk[] {
			return selectChunks(transcript);
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
		get telemetry(): TelemetryState {
			return telemetry;
		},
		get currentTurnId(): string | null {
			return transcript.currentTurnId;
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
			telemetry = foldMetricEvent(telemetry, msg.event);
			if (transcript.sealedTurnId !== null) {
				void syncTail();
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
		},

		dispose(): void {
			disposed = true;
		},
	};
}
