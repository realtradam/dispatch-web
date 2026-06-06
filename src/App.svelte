<script lang="ts">
	import { App, createAppStore } from "./app";

	const store = createAppStore();
</script>

<App {store} />
