<script lang="ts">
  /**
   * The `named-agents` view — a global, collapsible sidebar view of curated
   * presets. The store owns the list (authoritative for the model selector +
   * agent tooling); the view drives CRUD via injected ports (auto-save).
   * Unkeyed — the list is global (no {#key}, like today).
   */
  import {
    NamedAgentsView,
    type NamedAgentInput,
  } from "../../features/named-agents";
  import type { AppViewPorts } from "../view-ports";

  let { ports }: { ports: AppViewPorts } = $props();
  const store = $derived(ports.store);

  // Adapt the store's Named Agent CRUD to the named-agents feature's ports.
  const namedAgentPorts = {
    create: (input: NamedAgentInput) => store.createNamedAgent(input),
    update: (id: string, input: NamedAgentInput) => store.updateNamedAgent(id, input),
    remove: (id: string) => store.deleteNamedAgent(id),
  };
</script>

<NamedAgentsView agents={store.namedAgents} models={store.models} ports={namedAgentPorts} />
