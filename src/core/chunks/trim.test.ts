import type { StoredChunk } from "@dispatch/wire";
import { describe, expect, it } from "vitest";
import { applyHistory, initialState } from "./reducer";
import {
	DEFAULT_CHAT_LIMIT,
	initialWindowSize,
	MAX_CHAT_LIMIT,
	MIN_CHAT_LIMIT,
	normalizeChatLimit,
	restoreEarlier,
	selectHasEarlier,
	trimTranscript,
	unloadCount,
	windowTranscript,
} from "./trim";
import type { TranscriptState } from "./types";

function chunk(seq: number, type: "text" | "thinking" = "text"): StoredChunk {
	return { seq, role: "assistant", chunk: { type, text: `c${seq}` } };
}

function chunks(from: number, to: number): StoredChunk[] {
	const out: StoredChunk[] = [];
	for (let seq = from; seq <= to; seq++) out.push(chunk(seq));
	return out;
}

function stateWith(committed: readonly StoredChunk[]): TranscriptState {
	return { ...initialState(), committed };
}

describe("normalizeChatLimit", () => {
	it("defaults non-numeric / NaN / missing values", () => {
		expect(normalizeChatLimit(undefined)).toBe(DEFAULT_CHAT_LIMIT);
		expect(normalizeChatLimit(null)).toBe(DEFAULT_CHAT_LIMIT);
		expect(normalizeChatLimit("100")).toBe(DEFAULT_CHAT_LIMIT);
		expect(normalizeChatLimit(Number.NaN)).toBe(DEFAULT_CHAT_LIMIT);
		expect(normalizeChatLimit(Number.POSITIVE_INFINITY)).toBe(DEFAULT_CHAT_LIMIT);
	});

	it("floors and clamps numeric values", () => {
		expect(normalizeChatLimit(100.9)).toBe(100);
		expect(normalizeChatLimit(0)).toBe(MIN_CHAT_LIMIT);
		expect(normalizeChatLimit(-5)).toBe(MIN_CHAT_LIMIT);
		expect(normalizeChatLimit(10_000_000)).toBe(MAX_CHAT_LIMIT);
		expect(normalizeChatLimit(256)).toBe(256);
	});
});

describe("unloadCount / initialWindowSize", () => {
	it("unload is a quarter of the limit, rounded up", () => {
		expect(unloadCount(100)).toBe(25);
		expect(unloadCount(256)).toBe(64);
		expect(unloadCount(10)).toBe(3);
	});

	it("initial window is 75% of the limit, rounded down", () => {
		expect(initialWindowSize(100)).toBe(75);
		expect(initialWindowSize(256)).toBe(192);
		expect(initialWindowSize(1)).toBe(1); // never below 1
	});
});

describe("trimTranscript", () => {
	it("is the identity at or under the limit", () => {
		const at = stateWith(chunks(1, 100));
		expect(trimTranscript(at, 100)).toBe(at);
		const under = stateWith(chunks(1, 99));
		expect(trimTranscript(under, 100)).toBe(under);
	});

	it("unloads exactly a quarter when the limit is first exceeded (100 → 101 drops 25)", () => {
		const state = stateWith(chunks(1, 101));
		const next = trimTranscript(state, 100);
		expect(next.committed).toHaveLength(76);
		expect(next.committed[0]?.seq).toBe(26);
		expect(next.hiddenBeforeSeq).toBe(26);
	});

	it("unloads multiple quarters when trimming was deferred far past the limit", () => {
		const state = stateWith(chunks(1, 130));
		const next = trimTranscript(state, 100);
		// 130 → needs 2 quarters (25 each) to get to ≤ 100 → 80 remain.
		expect(next.committed).toHaveLength(80);
		expect(next.committed[0]?.seq).toBe(51);
		expect(next.hiddenBeforeSeq).toBe(51);
	});

	it("counts provisional + accumulating toward the limit but never drops them", () => {
		const base = stateWith(chunks(1, 98));
		const state: TranscriptState = {
			...base,
			provisional: [
				{ role: "user", chunk: { type: "text", text: "q" } },
				{ role: "assistant", chunk: { type: "text", text: "a" } },
			],
			accumulating: { kind: "text", text: "stream" },
		};
		// 98 + 2 + 1 = 101 > 100 → drop 25 committed.
		const next = trimTranscript(state, 100);
		expect(next.committed).toHaveLength(73);
		expect(next.provisional).toHaveLength(2);
		expect(next.accumulating).not.toBeNull();
	});

	it("caps the drop at the committed length", () => {
		const base = stateWith(chunks(1, 2));
		const provisional = Array.from({ length: 20 }, (_, i) => ({
			role: "assistant" as const,
			chunk: { type: "text" as const, text: `p${i}` },
		}));
		const state: TranscriptState = { ...base, provisional };
		const next = trimTranscript(state, 10);
		expect(next.committed).toHaveLength(0);
		expect(next.provisional).toHaveLength(20);
		// Watermark advances past the last dropped committed chunk.
		expect(next.hiddenBeforeSeq).toBe(3);
	});

	it("accumulates the hidden thinking count for stable render keys", () => {
		const committed = [chunk(1, "thinking"), ...chunks(2, 9), chunk(10, "thinking"), chunk(11)];
		const state = stateWith(committed);
		const next = trimTranscript(state, 10); // 11 > 10 → drop ceil(10/4)=3 oldest
		expect(next.committed[0]?.seq).toBe(4);
		expect(next.hiddenThinkingCount).toBe(1);
	});

	it("ignores a nonsensical limit", () => {
		const state = stateWith(chunks(1, 50));
		expect(trimTranscript(state, 0)).toBe(state);
		expect(trimTranscript(state, Number.NaN)).toBe(state);
	});
});

describe("windowTranscript", () => {
	it("keeps only the newest maxCommitted chunks and sets the watermark", () => {
		const state = stateWith(chunks(1, 1000));
		const next = windowTranscript(state, 75);
		expect(next.committed).toHaveLength(75);
		expect(next.committed[0]?.seq).toBe(926);
		expect(next.hiddenBeforeSeq).toBe(926);
		expect(selectHasEarlier(next)).toBe(true);
	});

	it("is the identity within the window", () => {
		const state = stateWith(chunks(1, 50));
		expect(windowTranscript(state, 75)).toBe(state);
		expect(selectHasEarlier(state)).toBe(false);
	});
});

describe("applyHistory respects the watermark", () => {
	it("does not resurrect chunks below hiddenBeforeSeq on a full-cache merge", () => {
		const trimmed = trimTranscript(stateWith(chunks(1, 101)), 100);
		expect(trimmed.hiddenBeforeSeq).toBe(26);
		// A later sync merges the FULL cache (seqs 1..101) — the unloaded prefix must stay out.
		const merged = applyHistory(trimmed, chunks(1, 101));
		expect(merged.committed[0]?.seq).toBe(26);
		expect(merged.committed).toHaveLength(76);
	});

	it("still merges the tail above the watermark", () => {
		const trimmed = trimTranscript(stateWith(chunks(1, 101)), 100);
		const merged = applyHistory(trimmed, chunks(100, 110));
		expect(merged.committed[merged.committed.length - 1]?.seq).toBe(110);
		expect(merged.committed[0]?.seq).toBe(26);
	});
});

describe("restoreEarlier", () => {
	it("pages the newest `count` earlier chunks back in and lowers the watermark", () => {
		const windowed = windowTranscript(stateWith(chunks(1, 1000)), 75); // loaded 926..1000
		const restored = restoreEarlier(windowed, chunks(1, 1000), 64);
		expect(restored.committed[0]?.seq).toBe(862);
		expect(restored.committed).toHaveLength(75 + 64);
		expect(restored.hiddenBeforeSeq).toBe(862);
		expect(selectHasEarlier(restored)).toBe(true);
	});

	it("clears the watermark when the restore exhausts known earlier history", () => {
		const windowed = windowTranscript(stateWith(chunks(1, 100)), 75); // hidden: 1..25
		const restored = restoreEarlier(windowed, chunks(1, 100), 64);
		expect(restored.committed).toHaveLength(100);
		expect(restored.committed[0]?.seq).toBe(1);
		expect(restored.hiddenBeforeSeq).toBe(0);
		expect(restored.hiddenThinkingCount).toBe(0);
		expect(selectHasEarlier(restored)).toBe(false);
	});

	it("clears the watermark when nothing is actually below it", () => {
		const windowed = windowTranscript(stateWith(chunks(50, 200)), 75);
		const restored = restoreEarlier(windowed, [], 64);
		expect(restored.hiddenBeforeSeq).toBe(0);
		expect(restored.committed).toEqual(windowed.committed);
	});

	it("is the identity when nothing is hidden", () => {
		const state = stateWith(chunks(1, 10));
		expect(restoreEarlier(state, chunks(1, 10), 5)).toBe(state);
	});

	it("decrements the hidden thinking count by the restored thinking chunks", () => {
		const committed = [chunk(1, "thinking"), chunk(2), chunk(3, "thinking"), ...chunks(4, 12)];
		const trimmed = trimTranscript(stateWith(committed), 10); // drops 3: seqs 1..3 (2 thinking)
		expect(trimmed.hiddenThinkingCount).toBe(2);
		const restored = restoreEarlier(trimmed, committed, 2); // restores seqs 2..3 (1 thinking)
		expect(restored.hiddenBeforeSeq).toBe(2);
		expect(restored.hiddenThinkingCount).toBe(1);
	});

	it("round-trips with trim: trim → restore-all yields the original committed list", () => {
		const original = chunks(1, 101);
		const trimmed = trimTranscript(stateWith(original), 100);
		const restored = restoreEarlier(trimmed, original, 1000);
		expect(restored.committed).toEqual(original);
		expect(restored.hiddenBeforeSeq).toBe(0);
	});
});
