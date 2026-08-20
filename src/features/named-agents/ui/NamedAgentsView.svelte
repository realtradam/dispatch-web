<script lang="ts">
  import { untrack } from "svelte";
  import type { NamedAgent } from "../logic/types";
  import type { NamedAgentPorts } from "./controller.svelte";
  import { createCardController, type CardController } from "./controller.svelte";
  import NamedAgentCard from "./NamedAgentCard.svelte";

  interface Row {
    key: number;
    agent: NamedAgent | null;
    controller: CardController;
  }

  let {
    agents,
    models,
    ports,
  }: {
    /** The persisted Named Agents (seed for the cards; the store stays authoritative for consumers). */
    agents: readonly NamedAgent[];
    /** Available models (`<provider>/<model>`) — the source of the provider/model dropdowns. */
    models: readonly string[];
    ports: NamedAgentPorts;
  } = $props();

  // The view OWNS the editable card rows (each a controller + its last-saved
  // canonical agent). Seeded once from the `agents` snapshot on mount (untracked
  // so a later store update — which this view drove — never clobbers an
  // in-flight draft). The store remains authoritative for other consumers.
  let rows = $state<Row[]>([]);
  let nextKey = $state(0);
  let seeded = $state(false);

  $effect(() => {
    untrack(() => {
      if (seeded) return;
      seeded = true;
      for (const a of agents) addRow(a);
    });
  });

  /**
   * The other rows' names (excluding the row with `rowKey`) for the uniqueness
   * hint. Identity is the ROW's stable `key` — a draft (`agent === null`) must
   * still exclude ITSELF (otherwise a fresh draft collides with its own name),
   * while any OTHER draft is a genuine sibling.
   */
  function otherNamesOf(rowKey: number): readonly string[] {
    const out: string[] = [];
    for (const r of rows) {
      if (r.key === rowKey) continue;
      out.push(r.agent !== null ? r.agent.name : r.controller.draft.name);
    }
    return out;
  }

  /**
   * Live uniqueness predicate for a card: true when `name` collides with a
   * SIBLING row (excludes the card's own row by its stable `rowKey` — not by a
   * nullable persisted id, so a draft excludes itself exactly once).
   */
  function isNameTakenFor(rowKey: number): (name: string) => boolean {
    return (name: string): boolean => {
      const lower = name.trim().toLowerCase();
      for (const r of rows) {
        if (r.key === rowKey) continue;
        const candidate = r.agent !== null ? r.agent.name : r.controller.draft.name;
        if (candidate.trim().toLowerCase() === lower) return true;
      }
      return false;
    };
  }

  function addRow(agent: NamedAgent | null): void {
    // Capture the row's stable key FIRST so the controller's callbacks reconcile
    // THIS row only — never a sibling draft (`agent === null` matches all).
    const key = nextKey++;
    const controller = createCardController({
      agent,
      savedModel: agent?.model ?? "",
      isNameTaken: isNameTakenFor(key),
      ports,
      onChanged: (saved) => replaceAgent(key, saved),
      onRemoved: () => removeRow(key),
    });
    rows = [...rows, { key, agent, controller }];
  }

  function replaceAgent(key: number, saved: NamedAgent): void {
    rows = rows.map((r) => (r.key === key ? { ...r, agent: saved } : r));
  }

  function removeRow(key: number): void {
    const row = rows.find((r) => r.key === key);
    if (row === undefined) return;
    row.controller.dispose();
    rows = rows.filter((r) => r.key !== key);
  }

  function addDraft(): void {
    addRow(null);
  }
</script>

<div class="flex flex-col gap-2">
  <ul class="flex flex-col gap-2">
    {#each rows as row (row.key)}
      <li>
        <NamedAgentCard
          models={models}
          agent={row.agent}
          controller={row.controller}
          otherNames={otherNamesOf(row.key)}
        />
      </li>
    {/each}
  </ul>

  {#if rows.length === 0}
    <p class="text-xs opacity-60">No named agents yet.</p>
  {/if}

  <button type="button" class="btn btn-ghost btn-xs w-fit" onclick={addDraft}>
    + Add Named Agent
  </button>
</div>