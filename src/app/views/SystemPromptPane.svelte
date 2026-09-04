<script lang="ts">
  /**
   * The `system-prompt` view — a pointer to the global system-prompt template
   * that opens the full-page modal editor (half template / half variable
   * palette). The modal itself is CHROME (App shell state, outside the tree —
   * layout-00 decision 2); this view only raises the port. Unkeyed (like
   * today).
   */
  import type { AppViewPorts } from "../view-ports";

  let { ports }: { ports: AppViewPorts } = $props();
</script>

<div class="flex flex-col gap-2">
  <p class="text-xs opacity-60">
    Edit the global system prompt template with variable placeholders. Opens a full-page editor.
  </p>
  <button type="button" class="btn btn-primary btn-sm" onclick={() => ports.openSystemPromptBuilder()}>
    Open builder
  </button>
</div>
