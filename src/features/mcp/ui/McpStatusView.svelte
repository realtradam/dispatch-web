<script lang="ts">
	import { untrack } from "svelte";
	import {
		type Badge,
		type LoadMcpStatus,
		type McpServerView,
		summarizeMcpServers,
		viewMcpServers,
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
		load: LoadMcpStatus;
	} = $props();

	const badgeClass: Record<Badge, string> = {
		success: "badge-success",
		warning: "badge-warning",
		error: "badge-error",
		neutral: "badge-ghost",
	};

	let servers = $state<readonly McpServerView[]>([]);
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
			servers = viewMcpServers(result.servers);
			summary = summarizeMcpServers(result.servers);
			loadedCwd = result.cwd;
		} else {
			error = result.error;
		}
	}

	// (Re)load on mount and whenever the conversation's cwd changes. The MCP GET
	// lazily spawns/connects servers, so we avoid a redundant fetch when `cwd`
	// resolves to the value we already loaded for.
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
				MCP servers
			{/if}
		</span>
		<button
			type="button"
			class="btn btn-ghost btn-xs"
			disabled={!canView || loading}
			onclick={() => refresh()}
			aria-label="Refresh MCP server status"
		>
			{#if loading}
				<span class="loading loading-spinner loading-xs"></span>
			{:else}
				Refresh
			{/if}
		</button>
	</div>

	{#if !canView}
		<p class="text-xs opacity-60">Open or start a conversation to see its MCP servers.</p>
	{:else if error}
		<p class="text-xs text-error">{error}</p>
	{:else if hasLoaded && loadedCwd === null}
		<p class="text-xs opacity-60">
			Set a working directory in the Model panel to enable MCP servers.
		</p>
	{:else if hasLoaded && servers.length === 0 && !loading}
		<p class="text-xs opacity-60">No MCP servers configured for this directory.</p>
	{:else}
		<ul class="flex flex-col gap-2">
			{#each servers as server (server.id)}
				<li class="flex flex-col gap-1 rounded-box bg-base-200 p-2 text-sm">
					<div class="flex items-center justify-between gap-2">
						<span class="font-medium font-mono">{server.id}</span>
						<span class="badge badge-sm {badgeClass[server.badge]} gap-1">
							{#if server.busy}
								<span class="loading loading-spinner loading-xs"></span>
							{/if}
							{server.statusLabel}
						</span>
					</div>
					<div class="flex items-center justify-between gap-2 text-xs opacity-60">
						{#if server.configSource}
							<span class="font-mono" title="Config source">{server.configSource}</span>
						{:else}
							<span></span>
						{/if}
						<span title="Discovered tools">{server.toolCount} tool{server.toolCount === 1 ? "" : "s"}</span>
					</div>
					{#if server.error}
						<span class="font-mono text-xs text-error">{server.error}</span>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</div>
