import type { SurfaceSpec } from "@dispatch/ui-contract";
import { describe, expect, it } from "vitest";
import {
	clampMinutes,
	clampSeconds,
	colorClass,
	formatCountdown,
	formatWarmLabel,
	fromMinSec,
	initialWarmingState,
	observeWarm,
	parseControls,
	parsePct,
	secondsUntilNext,
	statusForPct,
	toMinSec,
} from "./view-model";

const spec = (fields: SurfaceSpec["fields"]): SurfaceSpec => ({
	id: "cache-warming",
	region: "side",
	title: "Cache Warming",
	fields,
});

describe("parsePct", () => {
	it("parses a percentage string", () => {
		expect(parsePct("100%")).toBe(100);
		expect(parsePct("93 %")).toBe(93);
		expect(parsePct("0%")).toBe(0);
	});
	it("returns null for a dash / non-numeric", () => {
		expect(parsePct("—")).toBeNull();
		expect(parsePct("n/a")).toBeNull();
	});
});

describe("parseControls", () => {
	it("returns empty defaults for a null spec", () => {
		const c = parseControls(null);
		expect(c).toEqual({
			enabled: false,
			toggleActionId: null,
			intervalSeconds: 0,
			setIntervalActionId: null,
			lastPct: null,
			retentionPct: null,
			nextWarmAt: null,
			lastWarmAt: null,
		});
	});

	it("extracts toggle / number / both stats / timer by kind", () => {
		const c = parseControls(
			spec([
				{
					kind: "toggle",
					label: "Enabled",
					value: true,
					action: { actionId: "cache-warming/toggle" },
				},
				{
					kind: "number",
					label: "Interval",
					value: 240,
					unit: "s",
					action: { actionId: "cache-warming/set-interval" },
				},
				{ kind: "stat", label: "Last cache rate", value: "61%" },
				{ kind: "stat", label: "Cache retention", value: "100%" },
				{
					kind: "custom",
					rendererId: "cache-warming-timer",
					payload: { nextWarmAt: 1_700_000_240_000, lastWarmAt: 1_700_000_000_000 },
				},
			]),
		);
		expect(c).toEqual({
			enabled: true,
			toggleActionId: "cache-warming/toggle",
			intervalSeconds: 240,
			setIntervalActionId: "cache-warming/set-interval",
			lastPct: 61,
			retentionPct: 100,
			nextWarmAt: 1_700_000_240_000,
			lastWarmAt: 1_700_000_000_000,
		});
	});

	it("tells the retention stat apart from the rate stat by label", () => {
		const c = parseControls(
			spec([
				{ kind: "stat", label: "Cache retention", value: "100%" },
				{ kind: "stat", label: "Last cache rate", value: "61%" },
			]),
		);
		expect(c.retentionPct).toBe(100);
		expect(c.lastPct).toBe(61);
	});

	it("treats a '—' stat as no pct", () => {
		const c = parseControls(spec([{ kind: "stat", label: "Last cache rate", value: "—" }]));
		expect(c.lastPct).toBeNull();
	});

	it("ignores an unknown custom renderer and a malformed timer payload", () => {
		const c = parseControls(
			spec([
				{ kind: "custom", rendererId: "something-else", payload: { nextWarmAt: 5 } },
				{ kind: "custom", rendererId: "cache-warming-timer", payload: "nope" },
			]),
		);
		expect(c.nextWarmAt).toBeNull();
		expect(c.lastWarmAt).toBeNull();
	});
});

describe("interval ↔ min/sec", () => {
	it("clampSeconds caps at 0..59", () => {
		expect(clampSeconds(75)).toBe(59);
		expect(clampSeconds(-3)).toBe(0);
		expect(clampSeconds(30)).toBe(30);
		expect(clampSeconds(Number.NaN)).toBe(0);
	});
	it("clampMinutes floors at 0", () => {
		expect(clampMinutes(-1)).toBe(0);
		expect(clampMinutes(4)).toBe(4);
	});
	it("toMinSec splits total seconds", () => {
		expect(toMinSec(240)).toEqual({ minutes: 4, seconds: 0 });
		expect(toMinSec(125)).toEqual({ minutes: 2, seconds: 5 });
		expect(toMinSec(45)).toEqual({ minutes: 0, seconds: 45 });
	});
	it("fromMinSec combines (clamping seconds to 59)", () => {
		expect(fromMinSec(4, 0)).toBe(240);
		expect(fromMinSec(2, 5)).toBe(125);
		expect(fromMinSec(1, 75)).toBe(119); // 75s clamped to 59
	});
});

describe("status + formatting", () => {
	it("statusForPct buckets high/mid/low", () => {
		expect(statusForPct(100)).toBe("success");
		expect(statusForPct(80)).toBe("success");
		expect(statusForPct(60)).toBe("warning");
		expect(statusForPct(40)).toBe("warning");
		expect(statusForPct(10)).toBe("error");
	});
	it("colorClass maps to literal DaisyUI classes", () => {
		expect(colorClass("success")).toBe("text-success");
		expect(colorClass("warning")).toBe("text-warning");
		expect(colorClass("error")).toBe("text-error");
	});
	it("formatWarmLabel matches the manual-warm phrasing", () => {
		expect(formatWarmLabel(100)).toBe("Warmed — 100% cache hit");
		expect(formatWarmLabel(92.6)).toBe("Warmed — 93% cache hit");
	});
	it("formatCountdown renders s and m:ss", () => {
		expect(formatCountdown(9)).toBe("9s");
		expect(formatCountdown(59)).toBe("59s");
		expect(formatCountdown(60)).toBe("1:00");
		expect(formatCountdown(185)).toBe("3:05");
		expect(formatCountdown(-5)).toBe("0s");
	});
});

describe("warming history reducer (observeWarm)", () => {
	it("starts empty", () => {
		const s = initialWarmingState();
		expect(s.history).toEqual([]);
		expect(s.lastWarmAt).toBeNull();
	});

	it("records a new entry on each new authoritative lastWarmAt", () => {
		let s = initialWarmingState();
		s = observeWarm(s, 1000, 100);
		s = observeWarm(s, 2000, 90);
		expect(s.history).toEqual([
			{ pct: 90, at: 2000 },
			{ pct: 100, at: 1000 },
		]);
		expect(s.lastWarmAt).toBe(2000);
	});

	it("de-duplicates on the timestamp, not the pct (a re-pushed surface → no dup)", () => {
		let s = initialWarmingState();
		s = observeWarm(s, 1000, 100); // warm
		s = observeWarm(s, 1000, 100); // toggle/interval re-push, same lastWarmAt → skip
		expect(s.history).toHaveLength(1);
	});

	it("records two warms with the SAME pct (distinct timestamps both count)", () => {
		let s = initialWarmingState();
		s = observeWarm(s, 1000, 100);
		s = observeWarm(s, 2000, 100);
		expect(s.history.map((e) => e.at)).toEqual([2000, 1000]);
	});

	it("ignores a null lastWarmAt; a null pct advances the key without an entry", () => {
		let s = initialWarmingState();
		s = observeWarm(s, null, 100);
		expect(s.history).toEqual([]);
		s = observeWarm(s, 1000, null);
		expect(s.history).toEqual([]);
		expect(s.lastWarmAt).toBe(1000);
	});
});

describe("secondsUntilNext (authoritative, from nextWarmAt)", () => {
	it("is null when nothing is scheduled (nextWarmAt null)", () => {
		expect(secondsUntilNext(null, 5000)).toBeNull();
	});

	it("counts down to nextWarmAt, floored at 0", () => {
		expect(secondsUntilNext(10_000, 10_000)).toBe(0);
		expect(secondsUntilNext(250_000, 10_000)).toBe(240);
		expect(secondsUntilNext(70_000, 10_000)).toBe(60);
	});

	it("treats a nextWarmAt past the stale grace as not scheduled (belt-and-braces)", () => {
		// Within the 3s grace an on-time warm may briefly read "0s"…
		expect(secondsUntilNext(10_000, 11_000)).toBe(0);
		expect(secondsUntilNext(10_000, 13_000)).toBe(0);
		// …but beyond it the value is stale → null (the "waiting…" state).
		expect(secondsUntilNext(10_000, 13_001)).toBeNull();
		expect(secondsUntilNext(5_000, 999_999)).toBeNull();
	});
});
