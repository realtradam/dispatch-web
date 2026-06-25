<script lang="ts">
	import { App, createAppStore } from "./app";
	import { createHistoryAdapter } from "./adapters/history";
	import {
		createWorkspaceHttp,
		createWorkspaceStore,
		pageTitle,
		parsePath,
		WorkspacesHome,
		type Route,
	} from "./features/workspaces";
	import { resolveHttpUrl } from "./app/resolve-http-url";

	// Parse the route BEFORE creating the store so the boot draft + active
	// workspace are correct from the first render (no flash of the "default"
	// workspace when deep-linking to /<id>).
	const history = createHistoryAdapter();
	const initialRoute = parsePath(history.path);
	const store = createAppStore(
		initialRoute.kind === "workspace" ? { workspaceId: initialRoute.id } : {},
	);

	// The workspace HTTP edge shares the same httpBase resolution as the store.
	const httpBase = resolveHttpUrl(
		{
			VITE_HTTP_URL: import.meta.env.VITE_HTTP_URL,
			VITE_HTTP_PORT: import.meta.env.VITE_HTTP_PORT,
		},
		typeof location !== "undefined" ? location : undefined,
	);
	const workspaceStore = createWorkspaceStore(
		createWorkspaceHttp(httpBase, globalThis.fetch.bind(globalThis)),
	);

	let route = $state<Route>(initialRoute);

	// React to back/forward + programmatic navigation.
	$effect(() => {
		return history.subscribe((path) => {
			route = parsePath(path);
		});
	});

	// On entering a workspace: scope the store to it (idempotent — skip if already
	// scoped) + ensure the workspace exists (create-on-miss, so it appears in the
	// home list immediately). The backend also auto-creates on `chat.send`.
	$effect(() => {
		if (route.kind !== "workspace") return;
		const id = route.id;
		if (store.activeWorkspaceId !== id) {
			store.setActiveWorkspace(id);
		}
		void workspaceStore.ensure(id);
	});

	// Keep the browser tab title in sync with the route: "Dispatch" on the home
	// page, "Dispatch: {title}" on a workspace page (falling back to the URL slug
	// until the list loads it). Reads `route` + the workspace list, so it re-runs
	// on navigation and again once `ensure` refreshes the list.
	$effect(() => {
		if (typeof document === "undefined") return;
		document.title = pageTitle(route, workspaceStore.list);
	});

	function navigate(path: string): void {
		history.navigate(path);
	}
</script>

{#if route.kind === "home"}
	<WorkspacesHome store={workspaceStore} onNavigate={navigate} computers={store.computers} />
{:else}
	<App {store} />
{/if}
