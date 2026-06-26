import type { ReasoningEffort } from "@dispatch/transport-contract";
import { describe, expect, it } from "vitest";
import type { HeartbeatConfig, HeartbeatRun } from "./types";
import {
	badgeForStatus,
	DEFAULT_INTERVAL_MINUTES,
	effectiveSystemPrompt,
	effortOptions,
	emptyForm,
	formatRunTime,
	formDiffers,
	formFromConfig,
	isInheritingSystemPrompt,
	joinInterval,
	normalizeHeartbeatConfig,
	normalizeHeartbeatRuns,
	normalizeInterval,
	patchFromForm,
	persistedSystemPrompt,
	relativeLabel,
	splitInterval,
	statusLabelFor,
	viewRun,
	viewRuns,
} from "./view-model";

const NOW = Date.UTC(2026, 5, 25, 14, 30, 5); // 2026-06-25T14:30:05Z
const ISO_AT = "2026-06-25T14:30:05Z"; // exactly NOW
const run = (over: Partial<HeartbeatRun> = {}): HeartbeatRun => ({
	id: "run-1",
	conversationId: "conv-1",
	triggeredAt: ISO_AT,
	status: "completed",
	...over,
});

const config = (over: Partial<HeartbeatConfig> = {}): HeartbeatConfig => ({
	enabled: false,
	systemPrompt: "be helpful",
	taskPrompt: "check status",
	intervalMinutes: 15,
	model: "openai/gpt-4o",
	reasoningEffort: null,
	...over,
});

describe("badgeForStatus", () => {
	it("running → warning + busy (spinner)", () => {
		expect(badgeForStatus("running")).toEqual({ badge: "warning", busy: true });
	});
	it("completed → success, not busy", () => {
		expect(badgeForStatus("completed")).toEqual({ badge: "success", busy: false });
	});
	it("stopped → neutral, not busy", () => {
		expect(badgeForStatus("stopped")).toEqual({ badge: "neutral", busy: false });
	});
});

describe("statusLabelFor", () => {
	it("maps each status to a display label", () => {
		expect(statusLabelFor("running")).toBe("Running");
		expect(statusLabelFor("completed")).toBe("Completed");
		expect(statusLabelFor("stopped")).toBe("Stopped");
	});
});

describe("formatRunTime", () => {
	it("formats an ISO timestamp as HH:MM:SS (UTC components)", () => {
		// Uses local getHours/Minutes/Seconds; under UTC env (TZ=UTC) reads 14:30:05.
		// We assert the SHAPE (3 colon-separated 2-digit groups) so it's TZ-stable.
		expect(formatRunTime(ISO_AT)).toMatch(/^\d{2}:\d{2}:\d{2}$/);
		expect(formatRunTime(ISO_AT).split(":")).toHaveLength(3);
	});
	it("returns — for an unparseable timestamp", () => {
		expect(formatRunTime("not-a-date")).toBe("—");
		expect(formatRunTime("")).toBe("—");
	});
});

describe("relativeLabel", () => {
	it("just now when within a minute", () => {
		expect(relativeLabel(ISO_AT, NOW)).toBe("just now");
		expect(relativeLabel(ISO_AT, NOW + 30_000)).toBe("just now");
	});
	it("Nm ago under an hour", () => {
		expect(relativeLabel(ISO_AT, NOW + 5 * 60_000)).toBe("5m ago");
		expect(relativeLabel(ISO_AT, NOW + 59 * 60_000)).toBe("59m ago");
	});
	it("Nh ago under a day", () => {
		expect(relativeLabel(ISO_AT, NOW + 2 * 3_600_000)).toBe("2h ago");
	});
	it("absolute date+time past a day", () => {
		const label = relativeLabel(ISO_AT, NOW + 26 * 3_600_000);
		expect(label).toMatch(/^[A-Z][a-z]{2} \d+, \d{2}:\d{2}$/);
	});
	it("future timestamp → just now (clock skew tolerance)", () => {
		expect(relativeLabel(ISO_AT, NOW - 10_000)).toBe("just now");
	});
	it("returns — for an unparseable timestamp", () => {
		expect(relativeLabel("nope", NOW)).toBe("—");
	});
});

describe("viewRun / viewRuns", () => {
	it("running run: warning badge + busy + labels", () => {
		const v = viewRun(run({ status: "running" }), NOW);
		expect(v.badge).toBe("warning");
		expect(v.busy).toBe(true);
		expect(v.statusLabel).toBe("Running");
		expect(v.id).toBe("run-1");
		expect(v.conversationId).toBe("conv-1");
		expect(v.timeLabel).toMatch(/^\d{2}:\d{2}:\d{2}$/);
		expect(v.relativeLabel).toBe("just now");
	});
	it("completed run: success badge, not busy", () => {
		expect(viewRun(run({ status: "completed" }), NOW).badge).toBe("success");
	});
	it("stopped run: neutral badge, not busy", () => {
		expect(viewRun(run({ status: "stopped" }), NOW).badge).toBe("neutral");
	});
	it("viewRuns preserves order", () => {
		const views = viewRuns([run({ id: "a" }), run({ id: "b" })], NOW);
		expect(views.map((v) => v.id)).toEqual(["a", "b"]);
	});
});

describe("config form", () => {
	it("emptyForm has defaults (disabled, default interval split, default effort)", () => {
		const f = emptyForm();
		expect(f.enabled).toBe(false);
		// 30 min → 0h 30m
		expect(f.intervalHours).toBe(0);
		expect(f.intervalMinutes).toBe(30);
		expect(f.reasoningEffort).toBe("high"); // DEFAULT_REASONING_EFFORT
		expect(f.systemPrompt).toBe("");
		expect(f.model).toBe("");
	});

	it("formFromConfig resolves null reasoningEffort to the default", () => {
		const f = formFromConfig(config({ reasoningEffort: null }));
		expect(f.reasoningEffort).toBe("high");
	});

	it("formFromConfig passes through a set reasoningEffort", () => {
		const f = formFromConfig(config({ reasoningEffort: "max" }));
		expect(f.reasoningEffort).toBe("max");
	});

	it("formFromConfig splits intervalMinutes into hours + minutes (0–59)", () => {
		expect(formFromConfig(config({ intervalMinutes: 90 }))).toMatchObject({
			intervalHours: 1,
			intervalMinutes: 30,
		});
		expect(formFromConfig(config({ intervalMinutes: 60 }))).toMatchObject({
			intervalHours: 1,
			intervalMinutes: 0,
		});
		expect(formFromConfig(config({ intervalMinutes: 59 }))).toMatchObject({
			intervalHours: 0,
			intervalMinutes: 59,
		});
		expect(formFromConfig(config({ intervalMinutes: 1440 }))).toMatchObject({
			intervalHours: 24,
			intervalMinutes: 0,
		});
	});

	it("formFromConfig coerces malformed fields safely", () => {
		const f = formFromConfig(
			config({
				enabled: "yes" as unknown as boolean,
				intervalMinutes: -5,
				model: 42 as unknown as string,
				systemPrompt: undefined as unknown as string,
			}),
		);
		expect(f.enabled).toBe(false); // non-true → false
		// -5 clamps to 1 → 0h 1m
		expect(f.intervalHours).toBe(0);
		expect(f.intervalMinutes).toBe(1);
		expect(f.model).toBe(""); // non-string → ""
		expect(f.systemPrompt).toBe(""); // undefined → ""
	});

	it("normalizeInterval clamps to 1–1440 and rounds", () => {
		expect(normalizeInterval(0)).toBe(1);
		expect(normalizeInterval(-10)).toBe(1);
		expect(normalizeInterval(1.4)).toBe(1);
		expect(normalizeInterval(15.6)).toBe(16);
		expect(normalizeInterval(2000)).toBe(1440);
		expect(normalizeInterval("30" as unknown as number)).toBe(30); // default on non-number
		expect(normalizeInterval(undefined)).toBe(DEFAULT_INTERVAL_MINUTES);
	});

	it("splitInterval / joinInterval round-trip (and clamp)", () => {
		expect(splitInterval(90)).toEqual({ hours: 1, minutes: 30 });
		expect(splitInterval(0)).toEqual({ hours: 0, minutes: 1 }); // 0 → clamps to 1
		expect(splitInterval(1440)).toEqual({ hours: 24, minutes: 0 });
		expect(splitInterval(2000)).toEqual({ hours: 24, minutes: 0 }); // clamped
		// join recomputes + clamps
		expect(joinInterval(1, 30)).toBe(90);
		expect(joinInterval(0, 0)).toBe(1); // 0 → clamps to 1
		expect(joinInterval(25, 0)).toBe(1440); // 1500 → clamps to 1440
		expect(joinInterval(-1, 30)).toBe(30); // negatives floored to 0
		expect(joinInterval("x" as unknown as number, 15)).toBe(15); // non-finite → 0h
	});

	it("patchFromForm recombines hours+minutes into intervalMinutes + carries every field", () => {
		const f = formFromConfig(config({ intervalMinutes: 2000 }));
		// 2000 clamps to 1440 → 24h 0m in the form
		expect(f.intervalHours).toBe(24);
		expect(f.intervalMinutes).toBe(0);
		const patch = patchFromForm(f);
		expect(patch.intervalMinutes).toBe(1440);
		expect(patch.enabled).toBe(false);
		expect(patch.model).toBe("openai/gpt-4o");
		expect(patch.reasoningEffort).toBe("high");
		expect(patch.systemPrompt).toBe("be helpful");
		expect(patch.taskPrompt).toBe("check status");
	});

	it("patchFromForm recombines an arbitrary hours/minutes edit", () => {
		const f = formFromConfig(config({ intervalMinutes: 15 }));
		f.intervalHours = 2;
		f.intervalMinutes = 45;
		expect(patchFromForm(f).intervalMinutes).toBe(165);
	});

	it("formDiffers is false for a form seeded from the config (no edits)", () => {
		const c = config({ reasoningEffort: "medium" });
		const f = formFromConfig(c);
		expect(formDiffers(f, c)).toBe(false);
	});

	it("formDiffers is true after an edit", () => {
		const c = config();
		const f = formFromConfig(c);
		f.systemPrompt = "changed";
		expect(formDiffers(f, c)).toBe(true);
	});

	it("formDiffers is true after an interval edit (hours or minutes)", () => {
		const c = config({ intervalMinutes: 90 });
		const f = formFromConfig(c);
		f.intervalMinutes = 45; // 1h45m vs 1h30m
		expect(formDiffers(f, c)).toBe(true);
	});

	it("formDiffers treats null config effort as the default (matches the resolved form)", () => {
		const c = config({ reasoningEffort: null });
		const f = formFromConfig(c);
		expect(formDiffers(f, c)).toBe(false); // null resolves to "high" == form
	});
});

describe("system-prompt inheritance (override ⇄ global default)", () => {
	const DEFAULT = "You are a helpful assistant.";

	it("effectiveSystemPrompt: override wins when non-empty, else the default", () => {
		expect(effectiveSystemPrompt("custom", DEFAULT)).toBe("custom");
		expect(effectiveSystemPrompt("", DEFAULT)).toBe(DEFAULT);
	});

	it("isInheritingSystemPrompt: true iff the override is empty", () => {
		expect(isInheritingSystemPrompt("")).toBe(true);
		expect(isInheritingSystemPrompt("custom")).toBe(false);
	});

	it('persistedSystemPrompt: empty or matching-the-default → inherit ("")', () => {
		// matching the default → inherit (never duplicate the default into the config)
		expect(persistedSystemPrompt(DEFAULT, DEFAULT)).toBe("");
		// empty edit → inherit
		expect(persistedSystemPrompt("", DEFAULT)).toBe("");
	});

	it("persistedSystemPrompt: a distinct edit → the override verbatim", () => {
		expect(persistedSystemPrompt("custom", DEFAULT)).toBe("custom");
		expect(persistedSystemPrompt(DEFAULT + "\nmore", DEFAULT)).toBe(DEFAULT + "\nmore");
	});

	it("round-trip: inherit → display default → reset (no edit) → persist inherit", () => {
		// A heartbeat inheriting (override "") displays the default; with no edit,
		// persisting yields inherit ("") — so the global default stays the source.
		const override = "";
		const displayed = effectiveSystemPrompt(override, DEFAULT);
		expect(displayed).toBe(DEFAULT);
		expect(persistedSystemPrompt(displayed, DEFAULT)).toBe("");
	});

	it("round-trip: override → reset to default → persist inherit (clears override)", () => {
		// User had an override, clicks Reset (textarea ← default): persisting clears
		// the override ("" → inherit) because the text now matches the default.
		const afterReset = DEFAULT;
		expect(persistedSystemPrompt(afterReset, DEFAULT)).toBe("");
	});
});

describe("effortOptions re-export", () => {
	it("exposes the canonical ladder with the default marked", () => {
		const opts = effortOptions();
		const values = opts.map((o) => o.value) as readonly string[];
		expect(values).toEqual(["low", "medium", "high", "xhigh", "max"]);
		const def = opts.find((o) => o.value === "high");
		expect(def?.label).toBe("high (default)");
	});
});

describe("reasoningEffort type narrowing (sanity)", () => {
	// Ensures the imported ladder stays the wire's canonical set — if the wire
	// ladder changes, this test flags the drift alongside the chat feature.
	it("the five canonical levels", () => {
		const levels: readonly ReasoningEffort[] = ["low", "medium", "high", "xhigh", "max"];
		expect(levels).toHaveLength(5);
	});
});

describe("normalizeHeartbeatConfig", () => {
	it("passes through a well-formed config", () => {
		const c = normalizeHeartbeatConfig({
			enabled: true,
			systemPrompt: "sys",
			taskPrompt: "task",
			intervalMinutes: 20,
			model: "openai/gpt-4o",
			reasoningEffort: "max",
		});
		expect(c).toEqual({
			enabled: true,
			systemPrompt: "sys",
			taskPrompt: "task",
			intervalMinutes: 20,
			model: "openai/gpt-4o",
			reasoningEffort: "max",
		});
	});
	it("coerces a malformed body safely (never throws, never undefined)", () => {
		const c = normalizeHeartbeatConfig({
			enabled: "yes",
			intervalMinutes: -3,
			reasoningEffort: "bogus",
		});
		expect(c.enabled).toBe(false);
		expect(c.intervalMinutes).toBe(1);
		expect(c.reasoningEffort).toBeNull();
		expect(c.systemPrompt).toBe("");
		expect(c.taskPrompt).toBe("");
		expect(c.model).toBe("");
	});
	it("accepts a null reasoningEffort", () => {
		expect(normalizeHeartbeatConfig({ reasoningEffort: null }).reasoningEffort).toBeNull();
	});
	it("handles null / non-object input", () => {
		const c = normalizeHeartbeatConfig(null);
		expect(c.enabled).toBe(false);
		expect(c.intervalMinutes).toBe(DEFAULT_INTERVAL_MINUTES);
		expect(c.model).toBe("");
	});
	it("clamps a huge interval", () => {
		expect(normalizeHeartbeatConfig({ intervalMinutes: 99999 }).intervalMinutes).toBe(1440);
	});
});

describe("normalizeHeartbeatRuns", () => {
	it("maps a well-formed runs list", () => {
		const runs = normalizeHeartbeatRuns({
			runs: [
				{ id: "r1", conversationId: "c1", triggeredAt: "2026-06-25T10:00:00Z", status: "running" },
				{
					id: "r2",
					conversationId: "c2",
					triggeredAt: "2026-06-25T09:00:00Z",
					status: "completed",
				},
			],
		});
		expect(runs).toHaveLength(2);
		expect(runs[0]).toMatchObject({ id: "r1", status: "running" });
		expect(runs[1]).toMatchObject({ id: "r2", status: "completed" });
	});
	it("returns [] for malformed body", () => {
		expect(normalizeHeartbeatRuns(null)).toEqual([]);
		expect(normalizeHeartbeatRuns({})).toEqual([]);
		expect(normalizeHeartbeatRuns({ runs: "nope" })).toEqual([]);
	});
	it("drops runs missing id/conversationId and defaults unknown status", () => {
		const runs = normalizeHeartbeatRuns({
			runs: [
				{ id: "r1", conversationId: "c1", triggeredAt: "x", status: "garbage" },
				{ id: "", conversationId: "c2", triggeredAt: "x", status: "completed" },
				{ id: "r3", conversationId: "", triggeredAt: "x", status: "running" },
				{ id: "r4", conversationId: "c4", triggeredAt: "x", status: "stopped" },
			],
		});
		expect(runs).toHaveLength(2);
		expect(runs[0]?.status).toBe("completed"); // "garbage" → default
		expect(runs[0]?.id).toBe("r1");
		expect(runs[1]?.id).toBe("r4");
	});
});
