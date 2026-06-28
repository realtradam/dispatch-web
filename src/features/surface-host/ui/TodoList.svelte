<script lang="ts">
  import { parseTodoPayload } from "../logic/todo";

  let { payload }: { readonly payload: unknown } = $props();

  const data = $derived(parseTodoPayload(payload));
</script>

<!-- Fixed at 30% of the viewport height so the region is consistent whether the
     list is empty or overflowing — it always reserves the space and scrolls
     internally (mirrors the tabs view). -->
<ul class="flex h-[30vh] flex-col gap-1 overflow-y-auto pr-1">
  {#if data !== null && data.todos.length > 0}
    {#each data.todos as todo, i (i)}
      <li class="flex items-start gap-2 rounded-box bg-base-200 px-3 py-2 text-sm">
        <!-- Status indicator -->
        <span class="mt-0.5 shrink-0">
          {#if todo.status === "in_progress"}
            <span class="block h-4 w-4 rounded-full bg-primary"></span>
          {:else if todo.status === "completed"}
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="3"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="h-4 w-4 text-success"
            >
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
          {:else if todo.status === "cancelled"}
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="3"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="h-4 w-4 text-base-content/40"
            >
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          {:else}
            <!-- pending: empty circle -->
            <span class="block h-4 w-4 rounded-full border-2 border-base-content/30"></span>
          {/if}
        </span>

        <!-- Content -->
        <span
          class:flex-1={true}
          class:line-through={todo.status === "completed" || todo.status === "cancelled"}
          class:opacity-50={todo.status === "completed" || todo.status === "cancelled"}
        >
          {todo.content}
        </span>
      </li>
    {/each}
  {:else}
    <li class="text-xs opacity-60">No tasks yet.</li>
  {/if}
</ul>
