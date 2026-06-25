<script lang="ts">
	import { untrack } from "svelte";
	import { cwdChanged, normalizeCwd, type SaveCwd } from "../logic/view-model";

	let {
		cwd,
		canEdit,
		save,
	}: {
		/** The active conversation's persisted cwd, or null when unset. */
		cwd: string | null;
		/** Whether a real conversation is focused (a draft can't persist a cwd yet). */
		canEdit: boolean;
		save: SaveCwd;
	} = $props();

	// Start empty; the $effect below seeds from the (async-loaded) cwd prop. (Reading
	// the prop directly into initial $state would only capture its first value.)
	let value = $state("");
	let lastSeed = $state("");
	let saving = $state(false);
	let error = $state<string | null>(null);
	let justSaved = $state(false);

	// Seed the input from the persisted cwd (it loads async). Only reseed while the
	// field is untouched, so an in-flight load can't clobber what the user typed.
	// Re-mounted per conversation, so there is no cross-tab bleed.
	$effect(() => {
		const incoming = cwd ?? "";
		untrack(() => {
			if (value === lastSeed) value = incoming;
			lastSeed = incoming;
		});
	});

	const dirty = $derived(cwdChanged(value, cwd));

	async function handleSave() {
		if (saving || !canEdit || !dirty) return;
		saving = true;
		error = null;
		justSaved = false;
		const result = await save(normalizeCwd(value));
		saving = false;
		if (result === null) return;
		if (result.ok) {
			justSaved = true;
		} else {
			error = result.error;
		}
	}

	function onInput() {
		justSaved = false;
		error = null;
	}
</script>

<div class="flex flex-col gap-1">
	<span class="text-xs font-semibold uppercase opacity-60">Working directory</span>
	<div class="flex items-center gap-2">
		<input
			type="text"
			class="input input-bordered input-sm w-full font-mono text-xs"
			placeholder={canEdit ? "/abs/path/to/project" : "Open a conversation first"}
			bind:value
			disabled={!canEdit || saving}
			oninput={onInput}
			onkeydown={(e) => {
				if (e.key === "Enter") handleSave();
			}}
			aria-label="Working directory"
		/>
		<button
			type="button"
			class="btn btn-primary btn-sm"
			disabled={!canEdit || saving || !dirty}
			onclick={handleSave}
		>
			{#if saving}
				<span class="loading loading-spinner loading-xs"></span>
			{:else}
				Set
			{/if}
		</button>
	</div>
	{#if !canEdit}
		<p class="text-xs opacity-60">Start or open a conversation to set its working directory.</p>
	{:else if error}
		<p class="text-xs text-error">{error}</p>
	{:else if justSaved && !dirty}
		<p class="text-xs text-success">Saved.</p>
	{:else}
		<p class="text-xs opacity-50">Defaults each turn's cwd; drives the language servers below.</p>
	{/if}
</div>
