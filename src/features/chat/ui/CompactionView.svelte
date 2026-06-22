<script lang="ts">
	export type CompactNowResult =
		| { readonly ok: true; readonly messagesSummarized: number; readonly messagesKept: number }
		| { readonly ok: false; readonly error: string };

	export type SaveCompactPercentResult =
		| { readonly ok: true; readonly percent: number }
		| { readonly ok: false; readonly error: string };

	let {
		percent,
		canCompact,
		compactNow,
		savePercent,
	}: {
		/** The conversation's auto-compact percent (0-100), or null when not yet fetched. 0 = disabled. */
		percent: number | null;
		/** Whether a real conversation is focused (a draft has nothing to compact). */
		canCompact: boolean;
		compactNow: () => Promise<CompactNowResult | null>;
		savePercent: (percent: number) => Promise<SaveCompactPercentResult | null>;
	} = $props();

	const DEFAULT_PERCENT = 85;

	let compacting = $state(false);
	let compactError = $state<string | null>(null);
	let compactResult = $state<{ summarized: number; kept: number } | null>(null);

	let percentInput = $state("");
	let savingPercent = $state(false);
	let percentError = $state<string | null>(null);
	let percentSaved = $state(false);

	// Sync the input from the prop when it changes (focus switch / initial load).
	let lastPercent = $state<number | null>(null);
	$effect(() => {
		if (percent !== lastPercent) {
			lastPercent = percent;
			percentInput = percent !== null ? String(percent) : "";
			percentError = null;
			percentSaved = false;
		}
	});

	const percentLabel = $derived(
		percent == null
			? "Loading…"
			: percent === 0
				? "Disabled (manual only)"
				: percent === DEFAULT_PERCENT
					? `${percent}% (default)`
					: `${percent}%`,
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

	async function handleSavePercent() {
		const value = Number.parseInt(percentInput, 10);
		if (Number.isNaN(value) || value < 0 || value > 100) {
			percentError = "Must be 0-100";
			return;
		}
		savingPercent = true;
		percentError = null;
		percentSaved = false;
		const result = await savePercent(value);
		savingPercent = false;
		if (result === null) return;
		if (result.ok) {
			percentSaved = true;
		} else {
			percentError = result.error;
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

	<!-- Auto-compact percent -->
	<section class="flex flex-col gap-1">
		<span class="text-xs font-semibold uppercase opacity-60">Auto-compact percent</span>
		<div class="flex items-center gap-2">
			<input
				type="number"
				class="input input-bordered input-sm w-24"
				min="0"
				max="100"
				placeholder={String(DEFAULT_PERCENT)}
				value={percentInput}
				disabled={savingPercent}
				onchange={handleSavePercent}
				aria-label="Compact percent (0-100)"
			/>
			<span class="text-xs opacity-60">%</span>
			{#if savingPercent}
				<span class="loading loading-spinner loading-xs"></span>
			{/if}
		</div>
		<p class="text-xs opacity-50">
			Current: {percentLabel}
			<br />
			0 disables auto-compact. Default is {DEFAULT_PERCENT}%.
		</p>
		{#if percentError}
			<p class="text-xs text-error">{percentError}</p>
		{:else if percentSaved}
			<p class="text-xs text-success">Saved.</p>
		{/if}
	</section>
</div>
