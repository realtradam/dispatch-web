<script lang="ts">
	import type { InvokeMessage, SurfaceSpec } from "@dispatch/ui-contract";
	import { onMount, untrack } from "svelte";
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
		secondsUntilNext,
		statusForPct,
		toMinSec,
		type WarmingViewState,
		type WarmNow,
	} from "../logic/view-model";

	let {
		spec,
		canWarm,
		onInvoke,
		warmNow,
	}: {
		/** The cache-warming surface spec for the focused conversation, or null. */
		spec: SurfaceSpec | null;
		/** Whether a real conversation is focused (a draft has nothing to warm). */
		canWarm: boolean;
		onInvoke: (msg: InvokeMessage) => void;
		warmNow: WarmNow;
	} = $props();

	const controls = $derived(parseControls(spec));

	// View-model state (pure reducer) + the injected clock — owned here, not ambient.
	let vm = $state<WarmingViewState>(initialWarmingState());
	let now = $state(Date.now());
	let warming = $state(false);
	let errorText = $state<string | null>(null);
	// Transient result of the most recent manual warm (immediate feedback; history
	// itself is driven authoritatively by the surface's `lastWarmAt`).
	let manualResult = $state<{ cachePct: number; expectedCacheRate: number } | null>(null);

	// Local interval inputs, seeded from the surface and re-seeded only when the
	// surface's interval differs from what's shown (so a stray update mid-edit
	// doesn't clobber typing).
	let minutes = $state(0);
	let seconds = $state(0);

	onMount(() => {
		const id = setInterval(() => {
			now = Date.now();
		}, 1000);
		return () => clearInterval(id);
	});

	// Fold each authoritative warm (new `lastWarmAt`) into history.
	$effect(() => {
		const at = controls.lastWarmAt;
		const pct = controls.lastPct;
		untrack(() => {
			vm = observeWarm(vm, at, pct);
		});
	});

	// Keep the min/sec inputs in sync with the surface's interval.
	$effect(() => {
		const target = controls.intervalSeconds;
		untrack(() => {
			if (fromMinSec(minutes, seconds) !== target) {
				const ms = toMinSec(target);
				minutes = ms.minutes;
				seconds = ms.seconds;
			}
		});
	});

	const remaining = $derived(secondsUntilNext(controls.nextWarmAt, now));
	const history = $derived(vm.history);
	const latest = $derived(history[0] ?? null);
	const earlier = $derived(history.slice(1));

	function commitInterval() {
		const actionId = controls.setIntervalActionId;
		if (actionId === null || spec === null) return;
		onInvoke({ type: "invoke", surfaceId: spec.id, actionId, payload: fromMinSec(minutes, seconds) });
	}

	function onMinutes(event: Event) {
		const next = (event.target as HTMLInputElement).valueAsNumber;
		if (Number.isNaN(next)) return; // empty input — ignore, don't clobber to 0
		minutes = clampMinutes(next);
		commitInterval();
	}

	function onSeconds(event: Event) {
		const next = (event.target as HTMLInputElement).valueAsNumber;
		if (Number.isNaN(next)) return; // empty input — ignore, don't clobber to 0
		seconds = clampSeconds(next);
		commitInterval();
	}

	function onToggle() {
		const actionId = controls.toggleActionId;
		if (actionId === null || spec === null) return;
		// The toggle action FLIPS server-side; no payload.
		onInvoke({ type: "invoke", surfaceId: spec.id, actionId });
	}

	async function handleWarm() {
		if (warming) return;
		warming = true;
		errorText = null;
		const result = await warmNow();
		warming = false;
		if (result === null) return;
		if (result.ok) {
			// Immediate feedback only — the authoritative surface `update` (new
			// `lastWarmAt`) drives the history via `observeWarm`.
			manualResult = { cachePct: result.cachePct, expectedCacheRate: result.expectedCacheRate };
		} else {
			manualResult = null;
			errorText = result.error;
		}
	}
</script>

<div class="flex flex-col gap-3">
	<!-- Enabled -->
	<label class="flex items-center justify-between gap-2 text-sm">
		<span>Enabled</span>
		<input
			type="checkbox"
			class="toggle toggle-sm toggle-success"
			checked={controls.enabled}
			disabled={spec === null}
			onchange={onToggle}
		/>
	</label>

	<!-- Refresh interval: minutes + seconds (seconds capped at 59) -->
	<div class="flex items-center justify-between gap-2 text-sm">
		<span>Refresh interval</span>
		<span class="flex items-center gap-1">
			<input
				type="number"
				class="input input-bordered input-sm w-16"
				min="0"
				value={minutes}
				disabled={spec === null}
				onchange={onMinutes}
				aria-label="Interval minutes"
			/>
			<span class="opacity-60">m</span>
			<input
				type="number"
				class="input input-bordered input-sm w-16"
				min="0"
				max="59"
				value={seconds}
				disabled={spec === null}
				onchange={onSeconds}
				aria-label="Interval seconds"
			/>
			<span class="opacity-60">s</span>
		</span>
	</div>

	<!-- Countdown to the next automatic warm (authoritative: driven by nextWarmAt) -->
	{#if !controls.enabled}
		<p class="text-xs opacity-50">Warming paused.</p>
	{:else if remaining !== null}
		<p class="text-xs opacity-70">Next warm in {formatCountdown(remaining)}</p>
	{:else}
		<p class="text-xs opacity-50">Next warm: waiting…</p>
	{/if}

	<!-- Cross-turn retention (the "is warming working?" health signal) -->
	{#if controls.retentionPct !== null}
		<p class="text-xs {colorClass(statusForPct(controls.retentionPct))}">
			Cache retention: {controls.retentionPct}%
		</p>
	{/if}

	<!-- Manual trigger -->
	<button
		type="button"
		class="btn btn-sm btn-outline"
		disabled={!canWarm || warming}
		onclick={handleWarm}
	>
		{#if warming}
			<span class="loading loading-spinner loading-xs"></span>
			Warming…
		{:else}
			Warm now
		{/if}
	</button>

	{#if !canWarm}
		<p class="text-xs opacity-60">Open or start a conversation to control its cache warming.</p>
	{:else if errorText}
		<p class="text-xs text-error">{errorText}</p>
	{:else if manualResult}
		<!-- Headline the retention (cache health) over the raw hit %. -->
		<p class="text-xs {colorClass(statusForPct(manualResult.expectedCacheRate))}">
			Warmed — {manualResult.expectedCacheRate}% retained ({manualResult.cachePct}% of prompt cached)
		</p>
	{/if}

	<!-- Warming history: collapse whose title is the most recent warm, coloured by
	     hit %, with the earlier warmings inside. -->
	{#if latest}
		<div class="collapse collapse-arrow bg-base-200">
			<input type="checkbox" aria-label="Toggle warming history" />
			<div class="collapse-title min-h-0 py-2 font-normal text-sm {colorClass(statusForPct(latest.pct))}">
				{formatWarmLabel(latest.pct)}
			</div>
			<div class="collapse-content flex flex-col gap-1 text-sm">
				{#if earlier.length > 0}
					{#each earlier as entry, i (i)}
						<p class={colorClass(statusForPct(entry.pct))}>{formatWarmLabel(entry.pct)}</p>
					{/each}
				{:else}
					<p class="text-xs opacity-60">No earlier warmings.</p>
				{/if}
			</div>
		</div>
	{:else}
		<p class="text-xs opacity-60">No warming yet.</p>
	{/if}
</div>
