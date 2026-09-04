<script lang="ts">
  /**
   * The `tabs` view — the conversation tab list (moved out of the top bar into
   * the sidebar). Re-mounts per workspace so the filtered tab set + scroll
   * reset cleanly on a workspace switch (the {#key} moved inside the wrapper).
   */
  import { TabList } from "../../features/tabs";
  import type { AppViewPorts } from "../view-ports";

  let { ports }: { ports: AppViewPorts } = $props();
  const store = $derived(ports.store);
</script>

{#key store.activeWorkspaceId}
  <TabList
    tabs={store.tabs}
    activeConversationId={store.activeConversationId}
    statusFor={(id) => store.conversationStatus(id)}
    onSelect={(id) => store.selectTab(id)}
    onClose={(id) => store.closeTab(id)}
    onNewDraft={() => store.newDraft()}
    onRename={(id, title) => store.renameTab(id, title)}
  />
{/key}
