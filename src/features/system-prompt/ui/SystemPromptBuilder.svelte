<script lang="ts">
	import type { SystemPromptVariable } from "@dispatch/transport-contract";
	import { tick, untrack } from "svelte";
	import {
		buildTag,
		groupVariables,
		insertTag,
		isDynamicVariable,
		type LoadSystemPrompt,
		type LoadSystemPromptVariables,
		type SaveSystemPrompt,
	} from "../logic/view-model";

	let {
		loadPrompt,
		savePrompt,
		loadVariables,
		onClose,
	}: {
		loadPrompt: LoadSystemPrompt;
		savePrompt: SaveSystemPrompt;
		loadVariables: LoadSystemPromptVariables;
		onClose: () => void;
	} = $props();

	let value = $state("");
	let loadedTemplate = $state("");
	let loading = $state(false);
	let saving = $state(false);
	let error = $state<string | null>(null);
	let justSaved = $state(false);
	let variables = $state<readonly SystemPromptVariable[]>([]);
	let filePath = $state("");
	let textarea: HTMLTextAreaElement | null = null;

	const groups = $derived(groupVariables(variables));
	const hasChanges = $derived(value !== loadedTemplate);

	async function load() {
		untrack(() => {
			loading = true;
			error = null;
		});

		const [templateResult, variablesResult] = await Promise.all([loadPrompt(), loadVariables()]);

		loading = false;

		if (!templateResult.ok || !variablesResult.ok) {
			const parts: string[] = [];
			if (!templateResult.ok) parts.push(templateResult.error);
			if (!variablesResult.ok) parts.push(variablesResult.error);
			error = parts.join("; ");
			return;
		}

		value = templateResult.template;
		loadedTemplate = templateResult.template;
		variables = variablesResult.variables;
	}

	async function save() {
		if (saving || loading) return;
		saving = true;
		error = null;
		justSaved = false;
		const result = await savePrompt(value);
		saving = false;
		if (!result.ok) {
			error = result.error;
			return;
		}
		loadedTemplate = result.template;
		value = result.template;
		justSaved = true;
	}

	function reset() {
		value = loadedTemplate;
		error = null;
		justSaved = false;
	}

	async function insertTagAtCursor(tag: string) {
		if (textarea === null) return;
		const start = textarea.selectionStart;
		const end = textarea.selectionEnd;
		const insertion = insertTag(value, tag, start, end);
		value = insertion.template;
		await tick();
		textarea.focus();
		textarea.setSelectionRange(insertion.cursor, insertion.cursor);
	}

	async function insertFileVariable(type: string) {
		const path = filePath.trim();
		if (path.length === 0) return;
		await insertTagAtCursor(buildTag(type, path));
		filePath = "";
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === "Escape") onClose();
	}

	// Load on mount once.
	$effect(() => {
		void load();
	});
</script>

<svelte:window onkeydown={onKeydown} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
	role="dialog"
	aria-modal="true"
	aria-label="System prompt builder"
	tabindex="-1"
	onclick={onClose}
	onkeydown={onKeydown}
>
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div
		class="flex h-[85vh] w-full max-w-6xl flex-col overflow-hidden rounded-box bg-base-100 shadow-2xl"
		onclick={(e) => e.stopPropagation()}
	>
		<!-- Header -->
		<div class="flex shrink-0 items-center justify-between border-b border-base-300 px-4 py-3">
			<div class="flex items-center gap-2">
				<h2 class="text-sm font-semibold">System Prompt</h2>
				{#if loading}
					<span class="loading loading-spinner loading-xs"></span>
				{/if}
			</div>
			<button
				type="button"
				class="btn btn-ghost btn-sm btn-square"
				onclick={onClose}
				aria-label="Close system prompt builder"
			>
				✕
			</button>
		</div>

		<!-- Body: half editor / half variables -->
		<div class="flex min-h-0 flex-1">
			<!-- Left: template editor -->
			<div class="flex w-1/2 min-w-0 flex-col gap-2 border-r border-base-300 p-4">
				<textarea
					bind:this={textarea}
					bind:value
					class="textarea textarea-bordered min-h-0 w-full flex-1 resize-none font-mono text-xs"
					placeholder={loading ? "Loading template..." : "Edit the global system prompt template..."}
					disabled={loading}
					aria-label="System prompt template"
				></textarea>

				<div class="flex shrink-0 items-center gap-2">
					<button
						type="button"
						class="btn btn-primary btn-sm"
						disabled={loading || saving || !hasChanges}
						onclick={save}
					>
						{#if saving}
							<span class="loading loading-spinner loading-xs"></span>
						{:else}
							Save
						{/if}
					</button>
					<button
						type="button"
						class="btn btn-ghost btn-sm"
						disabled={loading || !hasChanges}
						onclick={reset}
					>
						Reset
					</button>
					{#if justSaved && !hasChanges}
						<span class="text-xs text-success">Saved.</span>
					{:else if hasChanges}
						<span class="text-xs opacity-60">Unsaved changes</span>
					{/if}
				</div>

				{#if error}
					<p class="shrink-0 text-xs text-error">{error}</p>
				{/if}
			</div>

			<!-- Right: variable palette -->
			<div class="flex w-1/2 min-w-0 flex-col overflow-y-auto p-4">
				<h3 class="mb-2 shrink-0 text-xs font-semibold uppercase opacity-60">Variables</h3>
				{#if groups.length === 0 && !loading}
					<p class="text-xs opacity-60">No variables available.</p>
				{/if}
				<div class="flex flex-col gap-3">
					{#each groups as group (group.type)}
						<div class="rounded-box bg-base-200 p-3">
							<span class="text-xs font-semibold uppercase opacity-70">{group.type}</span>
							<div class="mt-2 flex flex-wrap gap-1">
								{#each group.variables as variable (variable.type + variable.name)}
									{#if isDynamicVariable(variable)}
										<div class="flex items-center gap-1">
											<input
												type="text"
												class="input input-bordered input-xs w-32 font-mono"
												bind:value={filePath}
												placeholder={variable.name}
												onkeydown={(e) => {
													if (e.key === "Enter") void insertFileVariable(variable.type);
												}}
											/>
											<button
												type="button"
												class="btn btn-xs"
												onclick={() => void insertFileVariable(variable.type)}
											>
												Insert
											</button>
										</div>
									{:else}
										<button
											type="button"
											class="btn btn-xs"
											title={variable.description}
											onclick={() => void insertTagAtCursor(buildTag(variable.type, variable.name))}
										>
											{variable.name}
										</button>
									{/if}
								{/each}
							</div>
						</div>
					{/each}
				</div>
			</div>
		</div>
	</div>
</div>
