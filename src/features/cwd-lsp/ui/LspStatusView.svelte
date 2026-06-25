<script lang="ts">
	import { untrack } from "svelte";
	import {
		type Badge,
		type LoadLspStatus,
		type LspServerView,
		summarizeServers,
		viewLspServers,
	} from "../logic/view-model";

	let {
		cwd,
		canView,
		load,
	}: {
		/** The active conversation's cwd — the trigger to (re)load when it changes. */
		cwd: string | null;
		/** Whether a real conversation is focused. */
		canView: boolean;
		load: LoadLspStatus;
	} = $props();

	const badgeClass: Record<Badge, string> = {
		success: "badge-success",
		warning: "badge-warning",
		error: "badge-error",
		neutral: "badge-ghost",
	};

	let servers = $state<readonly LspServerView[]>([]);
	let loading = $state(false);
	let error = $state<string | null>(null);
	let loadedCwd = $state<string | null>(null);
	let hasLoaded = $state(false);
	let summary = $state("");

	async function refresh() {
		if (!canView) return;
		loading = true;
		error = null;
		const result = await load();
		loading = false;
		if (result === null) return;
		hasLoaded = true;
		if (result.ok) {
			servers = viewLspServers(result.servers);
			summary = summarizeServers(result.servers);
			loadedCwd = result.cwd;
		} else {
			error = result.error;
		}
	}

	// (Re)load on mount and whenever the conversation's cwd changes. The LSP GET
	// lazily spawns servers, so we avoid a redundant fetch when `cwd` resolves to
	// the value we already loaded for.
	$effect(() => {
		const target = cwd;
		const can = canView;
		untrack(() => {
			if (!can) return;
			if (!hasLoaded || target !== loadedCwd) void refresh();
		});
	});
</script>

<div class="flex flex-col gap-2">
	<div class="flex items-center justify-between gap-2">
		<span class="text-xs opacity-70">
			{#if loading}
				Resolving…
			{:else if hasLoaded && loadedCwd !== null}
				{summary}
			{:else}
				Language servers
			{/if}
		</span>
		<button
			type="button"
			class="btn btn-ghost btn-xs"
			disabled={!canView || loading}
			onclick={() => refresh()}
			aria-label="Refresh language server status"
		>
			{#if loading}
				<span class="loading loading-spinner loading-xs"></span>
			{:else}
				Refresh
			{/if}
		</button>
	</div>

	{#if !canView}
		<p class="text-xs opacity-60">Open or start a conversation to see its language servers.</p>
	{:else if error}
		<p class="text-xs text-error">{error}</p>
	{:else if hasLoaded && loadedCwd === null}
		<p class="text-xs opacity-60">
			Set a working directory in the Model panel to enable language servers.
		</p>
	{:else if hasLoaded && servers.length === 0 && !loading}
		<p class="text-xs opacity-60">No language servers configured for this directory.</p>
	{:else}
		<ul class="flex flex-col gap-2">
			{#each servers as server (server.id)}
				<li class="flex flex-col gap-1 rounded-box bg-base-200 p-2 text-sm">
					<div class="flex items-center justify-between gap-2">
						<span class="font-medium">{server.name}</span>
						<span class="badge badge-sm {badgeClass[server.badge]} gap-1">
							{#if server.busy}
								<span class="loading loading-spinner loading-xs"></span>
							{/if}
							{server.statusLabel}
						</span>
					</div>
					{#if server.extensionsLabel}
						<span class="font-mono text-xs opacity-60">{server.extensionsLabel}</span>
					{/if}
					<span class="truncate font-mono text-xs opacity-50" title={server.root}>{server.root}</span>
					{#if server.error}
						<span class="font-mono text-xs text-error">{server.error}</span>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</div>
