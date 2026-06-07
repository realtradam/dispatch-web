import type { WsClientMessage, WsServerMessage } from "@dispatch/transport-contract";
import type { AgentEvent, Chunk } from "@dispatch/wire";

/**
 * Compile-time exhaustiveness guard for `AgentEvent.type`.
 * If a variant is added/removed/renamed in `@dispatch/wire`, this function's
 * default branch becomes reachable → TypeScript error at build time.
 */
export function assertAgentEventExhaustive(event: AgentEvent): string {
	switch (event.type) {
		case "status":
			return "status";
		case "turn-start":
			return "turn-start";
		case "text-delta":
			return "text-delta";
		case "reasoning-delta":
			return "reasoning-delta";
		case "tool-call":
			return "tool-call";
		case "tool-result":
			return "tool-result";
		case "tool-output":
			return "tool-output";
		case "usage":
			return "usage";
		case "error":
			return "error";
		case "done":
			return "done";
		case "turn-sealed":
			return "turn-sealed";
		case "step-complete":
			return "step-complete";
		default:
			return event satisfies never;
	}
}

/**
 * Compile-time exhaustiveness guard for `Chunk.type`.
 */
export function assertChunkExhaustive(chunk: Chunk): string {
	switch (chunk.type) {
		case "text":
			return "text";
		case "thinking":
			return "thinking";
		case "tool-call":
			return "tool-call";
		case "tool-result":
			return "tool-result";
		case "error":
			return "error";
		case "system":
			return "system";
		default:
			return chunk satisfies never;
	}
}

/**
 * Compile-time exhaustiveness guard for `WsServerMessage.type`.
 * Covers both surface ops and chat ops.
 */
export function assertWsServerMessageExhaustive(msg: WsServerMessage): string {
	switch (msg.type) {
		case "catalog":
			return "catalog";
		case "surface":
			return "surface";
		case "update":
			return "update";
		case "error":
			return "error";
		case "chat.delta":
			return "chat.delta";
		case "chat.error":
			return "chat.error";
		default:
			return msg satisfies never;
	}
}

/**
 * Compile-time exhaustiveness guard for `WsClientMessage.type`.
 * Covers both surface ops and chat ops.
 */
export function assertWsClientMessageExhaustive(msg: WsClientMessage): string {
	switch (msg.type) {
		case "subscribe":
			return "subscribe";
		case "unsubscribe":
			return "unsubscribe";
		case "invoke":
			return "invoke";
		case "chat.send":
			return "chat.send";
		default:
			return msg satisfies never;
	}
}
