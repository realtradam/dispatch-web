<script lang="ts">
	export type CompactNowResult =
		| { readonly ok: true; readonly messagesSummarized: number; readonly messagesKept: number }
		| { readonly ok: false; readonly error: string };

	export type SaveCompactThresholdResult =
		| { readonly ok: true; readonly threshold: number }
		| { readonly ok: false; readonly error: string };

	let {
		threshold,
		canCompact,
		compactNow,
		saveThreshold,
	}: {
		/** The conversation's auto-compact threshold, or null when not yet fetched. 0 = disabled. */
		threshold: number | null;
		/** Whether a real conversation is focused (a draft has nothing to compact). */
		canCompact: boolean;
		compactNow: () => Promise<CompactNowResult | null>;
		saveThreshold: (threshold: number) => Promise<SaveCompactThresholdResult | null>;
	} = $props();

	const DEFAULT_THRESHOLD = 350000;

	let compacting = $state(false);
	let compactError = $state<string | null>(null);
	let compactResult = $state<{ summarized: number; kept: number } | null>(null);

	let thresholdInput = $state("");
	let savingThreshold = $state(false);
	let thresholdError = $state<string | null>(null);
	let thresholdSaved = $state(false);

	// Sync the input from the prop when it changes (focus switch / initial load).
	let lastThreshold = $state<number | null>(null);
	$effect(() => {
		if (threshold !== lastThreshold) {
			lastThreshold = threshold;
			thresholdInput = threshold !== null ? String(threshold) : "";
			thresholdError = null;
			thresholdSaved = false;
		}
	});

	const thresholdLabel = $derived(
		threshold == null
			? "Loading…"
			: threshold === 0
				? "Disabled (manual only)"
				: threshold === DEFAULT_THRESHOLD
					? `${threshold.toLocaleString("en-US")} (default)`
					: threshold.toLocaleString("en-US"),
	);

	async function handleCompact() {
		if (compacting || !canCompact) return;
		compacting = true;
		compactError = null;
		compactResult = null;
		const result = await compactNow();
		compacting = false;
		if (result === null) return;
		if (result.ok) {
			compactResult = { summarized: result.messagesSummarized, kept: result.messagesKept };
		} else {
			compactError = result.error;
		}
	}

	async function handleSaveThreshold() {
		const value = Number.parseInt(thresholdInput, 10);
		if (Number.isNaN(value) || value < 0) {
			thresholdError = "Must be a non-negative number";
			return;
		}
		savingThreshold = true;
		thresholdError = null;
		thresholdSaved = false;
		const result = await saveThreshold(value);
		savingThreshold = false;
		if (result === null) return;
		if (result.ok) {
			thresholdSaved = true;
		} else {
			thresholdError = result.error;
		}
	}
</script>

<div class="flex flex-col gap-3">
	<!-- Manual compaction -->
	<section class="flex flex-col gap-1">
		<span class="text-xs font-semibold uppercase opacity-60">Manual compaction</span>
		<button
			type="button"
			class="btn btn-sm btn-outline"
			disabled={!canCompact || compacting}
			onclick={handleCompact}
		>
			{#if compacting}
				<span class="loading loading-spinner loading-xs"></span>
				Compacting…
			{:else}
				Compact now
			{/if}
		</button>
		{#if !canCompact}
			<p class="text-xs opacity-60">Open or start a conversation to compact its history.</p>
		{:else if compactError}
			<p class="text-xs text-error">{compactError}</p>
		{:else if compactResult}
			<p class="text-xs text-success">
				Compacted — {compactResult.summarized} messages summarized, {compactResult.kept} kept.
			</p>
		{:else}
			<p class="text-xs opacity-50">
				Summarizes old messages into a system summary + retains the most recent messages.
			</p>
		{/if}
	</section>

	<!-- Auto-compact threshold -->
	<section class="flex flex-col gap-1">
		<span class="text-xs font-semibold uppercase opacity-60">Auto-compact threshold</span>
		<div class="flex items-center gap-2">
			<input
				type="number"
				class="input input-bordered input-sm w-32"
				min="0"
				placeholder={DEFAULT_THRESHOLD.toLocaleString("en-US")}
				value={thresholdInput}
				disabled={savingThreshold}
				onchange={handleSaveThreshold}
				aria-label="Compact threshold (tokens)"
			/>
			<span class="text-xs opacity-60">tokens</span>
			{#if savingThreshold}
				<span class="loading loading-spinner loading-xs"></span>
			{/if}
		</div>
		<p class="text-xs opacity-50">
			Current: {thresholdLabel}
			<br />
			0 disables auto-compact. Default is {DEFAULT_THRESHOLD.toLocaleString("en-US")}.
		</p>
		{#if thresholdError}
			<p class="text-xs text-error">{thresholdError}</p>
		{:else if thresholdSaved}
			<p class="text-xs text-success">Saved.</p>
		{/if}
	</section>
</div>
