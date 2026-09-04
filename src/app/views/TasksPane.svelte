<script lang="ts">
  /**
   * The `tasks` view — the todo extension's per-conversation task list
   * (model-maintained, read-only). Re-mounts per conversation so the task list
   * is isolated per conversation (the {#key} moved inside the wrapper).
   * TodoList always reserves its fixed height (empty or full).
   */
  import TodoList from "../../features/surface-host/ui/TodoList.svelte";
  import { parseTodoPayload } from "../../features/surface-host/logic/todo";
  import type { AppViewPorts } from "../view-ports";

  // The `todo` extension's per-conversation task list surface.
  const TODO_ID = "todo";

  let { ports }: { ports: AppViewPorts } = $props();
  const store = $derived(ports.store);

  const todoData = $derived.by(() => {
    const spec = store.surface(TODO_ID);
    if (spec === null) return null;
    const field = spec.fields.find((f) => f.kind === "custom" && f.rendererId === TODO_ID);
    if (field === undefined || field.kind !== "custom") return null;
    return parseTodoPayload(field.payload);
  });
</script>

{#key store.activeConversationId}
  <TodoList payload={todoData} />
{/key}
