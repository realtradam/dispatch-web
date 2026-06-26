<script lang="ts">
	import type { SystemPromptVariable } from "@dispatch/transport-contract";
	import { tick, untrack } from "svelte";
	import {
		buildTag,
		groupVariables,
		insertTag,
		isDynamicVariable,
		type LoadSystemPromptVariables,
	} from "../../system-prompt";
	import type { SaveHeartbeatConfig } from "../logic/types";
	import { portal } from "../../../adapters/portal";

	let {
		systemPrompt,
		taskPrompt,
		loadVariables,
		saveConfig,
		onSaved,
		onClose,
	}: {
		/** The current system prompt (seeded from the loaded config). */
		systemPrompt: string;
		/** The current task prompt (seeded from the loaded config). */
		taskPrompt: string;
		/** Load the available variables (`GET /system-prompt/variables`). */
		loadVariables: LoadSystemPromptVariables;
		/** Persist both prompts via a partial heartbeat config PUT. */
		saveConfig: SaveHeartbeatConfig;
		/** Called after a successful save with the persisted prompts, so the parent
		 *  can sync its form (the editor edits local copies). */
		onSaved: (systemPrompt: string, taskPrompt: string) => void;
		onClose: () => void;
	} = $props();

	// Local editable copies (the modal edits in isolation; Save commits both).
	// Seeded ONCE from the props via `untrack` — the modal is re-mounted per open
	// (keyed by the parent), so it captures the initial prompts, not a live view.
	let system = $state(untrack(() => systemPrompt));
	let task = $state(untrack(() => taskPrompt));
	/** Snapshots at open, to diff against (drives Save + Reset). */
	let loadedSystem = $state(untrack(() => systemPrompt));
	let loadedTask = $state(untrack(() => taskPrompt));

	let variables = $state<readonly SystemPromptVariable[]>([]);
	let varsLoading = $state(false);
	let varsError = $state<string | null>(null);

	let saving = $state(false);
	let saveError = $state<string | null>(null);
	let justSaved = $state(false);

	// The textarea currently focused — variable insertion targets THIS one.
	type Field = "system" | "task";
	let activeField = $state<Field>("system");
	let systemEl = $state<HTMLTextAreaElement | null>(null);
	let taskEl = $state<HTMLTextAreaElement | null>(null);

	const groups = $derived(groupVariables(variables));
	const hasChanges = $derived(system !== loadedSystem || task !== loadedTask);

	async function loadVars(): Promise<void> {
		untrack(() => {
			varsLoading = true;
			varsError = null;
		});
		const result = await loadVariables();
		varsLoading = false;
		if (result.ok) {
			variables = result.variables;
		} else {
			varsError = result.error;
		}
	}

	async function save(): Promise<void> {
		if (saving || !hasChanges) return;
		saving = true;
		saveError = null;
		justSaved = false;
		const result = await saveConfig({ systemPrompt: system, taskPrompt: task });
		saving = false;
		if (result === null) return;
		if (result.ok) {
			loadedSystem = system;
			loadedTask = task;
			justSaved = true;
			onSaved(system, task);
		} else {
			saveError = result.error;
		}
	}

	function reset(): void {
		system = loadedSystem;
		task = loadedTask;
		saveError = null;
		justSaved = false;
	}

	/**
	 * Insert a variable tag into the ACTIVE textarea at its cursor. The active
	 * field is tracked via focus handlers; insertion uses that field's element +
	 * its own text (so a tag never lands in the wrong box).
	 */
	async function insertAtActive(tag: string): Promise<void> {
		const el = activeField === "system" ? systemEl : taskEl;
		if (el === null) return;
		const start = el.selectionStart;
		const end = el.selectionEnd;
		if (activeField === "system") {
			const ins = insertTag(system, tag, start, end);
			system = ins.template;
			await tick();
			el.focus();
			el.setSelectionRange(ins.cursor, ins.cursor);
		} else {
			const ins = insertTag(task, tag, start, end);
			task = ins.template;
			await tick();
			el.focus();
			el.setSelectionRange(ins.cursor, ins.cursor);
		}
	}

	/** Dynamic (file:<path>) variable: build the tag from the input + insert. */
	async function insertDynamic(type: string, path: string): Promise<void> {
		const trimmed = path.trim();
		if (trimmed.length === 0) return;
		await insertAtActive(buildTag(type, trimmed));
	}

	function onKeydown(e: KeyboardEvent): void {
		if (e.key === "Escape") onClose();
	}

	// Load the variable palette once on open.
	$effect(() => {
		void loadVars();
	});
</script>

<svelte:window onkeydown={onKeydown} />

<!-- Teleported to <body> (use:portal) so `position: fixed` resolves against the
     VIEWPORT, not the sidebar's `transform: translateX(...)` container — an
     ancestor transform establishes a containing block for `fixed`, which would
     otherwise clip this overlay to the sidebar area. (RunModal/SystemPromptBuilder
     avoid this by rendering at the composition root; this modal lives inside
     HeartbeatView, so it must escape its ancestor.) -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	use:portal
	class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
	role="dialog"
	aria-modal="true"
	aria-label="Heartbeat prompt editor"
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
				<h2 class="text-sm font-semibold">Heartbeat Prompts</h2>
				{#if varsLoading}
					<span class="loading loading-spinner loading-xs"></span>
				{/if}
			</div>
			<button
				type="button"
				class="btn btn-ghost btn-sm btn-square"
				onclick={onClose}
				aria-label="Close prompt editor"
			>
				✕
			</button>
		</div>

		<!-- Body: half editor (two boxes) / half variables -->
		<div class="flex min-h-0 flex-1">
			<!-- Left: two text editors (system top, task bottom) -->
			<div class="flex w-1/2 min-w-0 flex-col gap-2 border-r border-base-300 p-4">
				<div class="flex min-h-0 flex-1 flex-col gap-1">
					<span class="shrink-0 text-xs font-semibold uppercase opacity-60">System prompt</span>
					<textarea
						bind:this={systemEl}
						bind:value={system}
						onfocus={() => (activeField = "system")}
						class="textarea textarea-bordered min-h-0 w-full flex-1 resize-none font-mono text-xs"
						placeholder="You are an autonomous agent…"
						disabled={saving}
						aria-label="Heartbeat system prompt"
					></textarea>
				</div>

				<div class="flex min-h-0 flex-1 flex-col gap-1">
					<span class="shrink-0 text-xs font-semibold uppercase opacity-60">Task prompt</span>
					<textarea
						bind:this={taskEl}
						bind:value={task}
						onfocus={() => (activeField = "task")}
						class="textarea textarea-bordered min-h-0 w-full flex-1 resize-none font-mono text-xs"
						placeholder="Check the system status and report…"
						disabled={saving}
						aria-label="Heartbeat task prompt"
					></textarea>
				</div>

				<div class="flex shrink-0 flex-wrap items-center gap-2">
					<button
						type="button"
						class="btn btn-primary btn-sm"
						disabled={saving || !hasChanges}
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
						disabled={!hasChanges}
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

				{#if saveError}
					<p class="shrink-0 text-xs text-error">{saveError}</p>
				{/if}
			</div>

			<!-- Right: variable palette -->
			<div class="flex w-1/2 min-w-0 flex-col overflow-y-auto p-4">
				<h3 class="mb-2 shrink-0 text-xs font-semibold uppercase opacity-60">Variables</h3>
				<p class="mb-3 shrink-0 text-xs opacity-50">
					Click a variable to insert it into the focused prompt box.
				</p>
				{#if varsError}
					<p class="text-xs text-error">{varsError}</p>
				{:else if groups.length === 0 && !varsLoading}
					<p class="text-xs opacity-60">No variables available.</p>
				{:else}
					<div class="flex flex-col gap-3">
						{#each groups as group (group.type)}
							<div class="rounded-box bg-base-200 p-3">
								<span class="text-xs font-semibold uppercase opacity-70">{group.type}</span>
								<div class="mt-2 flex flex-wrap gap-1">
									{#each group.variables as variable (variable.type + variable.name)}
										{#if isDynamicVariable(variable)}
											<!-- Dynamic (file:<path>) variable: a path input + Insert button. -->
											<div class="flex items-center gap-1">
												<input
													type="text"
													class="input input-bordered input-xs w-32 font-mono"
													placeholder={variable.name}
													onkeydown={(e) => {
														if (e.key === "Enter") {
															const v = e.currentTarget.value;
															void insertDynamic(variable.type, v);
															e.currentTarget.value = "";
														}
													}}
												/>
												<button
													type="button"
													class="btn btn-xs"
													onclick={(e) => {
														const input = (e.currentTarget as HTMLButtonElement)
															.previousElementSibling as HTMLInputElement | null;
														if (input !== null) {
															void insertDynamic(variable.type, input.value);
															input.value = "";
														}
													}}
												>
													Insert
												</button>
											</div>
										{:else}
											<button
												type="button"
												class="btn btn-xs"
												title={variable.description}
												onclick={() =>
													void insertAtActive(buildTag(variable.type, variable.name))}
											>
												{variable.name}
											</button>
										{/if}
									{/each}
								</div>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	</div>
</div>
