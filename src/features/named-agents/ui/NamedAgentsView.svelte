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

  /** The other rows' names (excluding the row with `exceptId`, or the given draft) — for the uniqueness hint. */
  function otherNamesOf(exceptId: string | null): readonly string[] {
    const out: string[] = [];
    for (const r of rows) {
      if (r.agent !== null) {
        if (r.agent.id !== exceptId) out.push(r.agent.name);
      } else if (exceptId === null) {
        out.push(r.controller.draft.name);
      }
    }
    return out;
  }

  /** Live uniqueness predicate for a card: true when `name` collides with a SIBLING row (excludes the card's own id). */
  function isNameTakenFor(exceptId: string | null): (name: string) => boolean {
    return (name: string): boolean => {
      const lower = name.trim().toLowerCase();
      for (const r of rows) {
        if (r.agent !== null) {
          if (r.agent.id !== exceptId && r.agent.name.trim().toLowerCase() === lower) return true;
        } else if (exceptId === null && r.controller.draft.name.trim().toLowerCase() === lower) {
          return true;
        }
      }
      return false;
    };
  }

  function addRow(agent: NamedAgent | null): void {
    const exceptId = agent?.id ?? null;
    const controller = createCardController({
      agent,
      savedModel: agent?.model ?? "",
      isNameTaken: isNameTakenFor(exceptId),
      ports,
      onChanged: (saved) => replaceAgent(agent, saved),
      onRemoved: () => removeRow(agent),
    });
    rows = [...rows, { key: nextKey++, agent, controller }];
  }

  function replaceAgent(original: NamedAgent | null, saved: NamedAgent): void {
    rows = rows.map((r) => {
      const sameOriginal = r.agent === original || (r.agent === null && original === null);
      return sameOriginal ? { ...r, agent: saved } : r;
    });
  }

  function removeRow(agent: NamedAgent | null): void {
    const row = rows.find((r) => r.agent === agent || (agent === null && r.agent === null));
    if (row === undefined) return;
    row.controller.dispose();
    rows = rows.filter((r) => r !== row);
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
          otherNames={otherNamesOf(row.agent?.id ?? null)}
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