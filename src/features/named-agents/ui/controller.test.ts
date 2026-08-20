import { afterEach, describe, expect, it, vi } from "vitest";
import type { NamedAgent, NamedAgentInput, NamedAgentSaveResult } from "../logic/types";
import { createCardController, type NamedAgentPorts } from "./controller.svelte";

function fakePorts(overrides?: {
  create?: NamedAgentPorts["create"];
  update?: NamedAgentPorts["update"];
  remove?: NamedAgentPorts["remove"];
  debounceMs?: number;
}): {
  ports: NamedAgentPorts;
  created: NamedAgentInput[];
  updated: Array<{ id: string; input: NamedAgentInput }>;
  removed: string[];
} {
  const created: NamedAgentInput[] = [];
  const updated: Array<{ id: string; input: NamedAgentInput }> = [];
  const removed: string[] = [];
  const settle = (r: NamedAgentSaveResult) => Promise.resolve(r);
  return {
    ports: {
      create:
        overrides?.create ??
        ((input) => {
          created.push(input);
          return settle({ ok: true, agent: { id: `new-${created.length}`, ...input } });
        }),
      update:
        overrides?.update ??
        ((id, input) => {
          updated.push({ id, input });
          return settle({ ok: true, agent: { id, ...input } });
        }),
      remove:
        overrides?.remove ??
        ((id) => {
          removed.push(id);
          return Promise.resolve({ ok: true } as const);
        }),
      debounceMs: overrides?.debounceMs ?? 0,
    } as NamedAgentPorts,
    created,
    updated,
    removed,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("createCardController", () => {
  it("creates a new draft when it becomes fully usable and the model is set", async () => {
    vi.useFakeTimers();
    const { ports, created } = fakePorts();
    const changed: NamedAgent[] = [];
    const c = createCardController({
      agent: null,
      savedModel: "",
      isNameTaken: () => false,
      ports,
      onChanged: (a) => changed.push(a),
      onRemoved: () => {},
    });
    c.setName("Coding Agent");
    c.setProvider("opencode-1");
    c.setModel("claude-sonnet-4.5");
    // The model setter saves immediately (the create is dispatched synchronously).
    expect(created).toHaveLength(1);
    expect(created[0]).toEqual({ name: "Coding Agent", model: "opencode-1/claude-sonnet-4.5" });
    // The canonical record + onChanged land after the create promise resolves.
    await vi.runAllTimersAsync();
    expect(changed).toHaveLength(1);
    expect(changed[0]?.id).toBe("new-1");
    c.dispose();
  });

  it("does not create with only a name (needs a provider + model)", () => {
    vi.useFakeTimers();
    const { ports, created } = fakePorts();
    const c = createCardController({
      agent: null,
      savedModel: "",
      isNameTaken: () => false,
      ports,
      onChanged: () => {},
      onRemoved: () => {},
    });
    c.setName("Coding Agent");
    vi.advanceTimersByTime(500);
    expect(created).toHaveLength(0);
    c.dispose();
  });

  it("does not persist a name that is already taken", () => {
    vi.useFakeTimers();
    const { ports, created } = fakePorts();
    const c = createCardController({
      agent: null,
      savedModel: "",
      isNameTaken: (name) => name.toLowerCase() === "coding agent",
      ports,
      onChanged: () => {},
      onRemoved: () => {},
    });
    c.setName("Coding Agent");
    c.setProvider("opencode-1");
    c.setModel("claude-sonnet-4.5");
    expect(created).toHaveLength(0);
    c.dispose();
  });

  it("updates an existing card and reports Saved once clean", async () => {
    vi.useFakeTimers();
    const existing: NamedAgent = {
      id: "a1",
      name: "Coding",
      model: "opencode-1/claude-sonnet-4.5",
    };
    const { ports, updated } = fakePorts({ debounceMs: 100 });
    const c = createCardController({
      agent: existing,
      savedModel: existing.model,
      isNameTaken: () => false,
      ports,
      onChanged: () => {},
      onRemoved: () => {},
    });
    expect(c.save.status).toBe("saved");
    c.setName("Coding X");
    // Within the debounce window the edit is unsaved → "dirty".
    await vi.advanceTimersByTimeAsync(20);
    expect(c.save.status).toBe("dirty");
    // Past the debounce the name save fires → the update is dispatched.
    await vi.advanceTimersByTimeAsync(200);
    expect(updated).toHaveLength(1);
    expect(updated[0]?.id).toBe("a1");
    expect(updated[0]?.input.name).toBe("Coding X");
    // After the update promise resolves the card reads clean → "saved".
    await vi.runAllTimersAsync();
    expect(c.save.status).toBe("saved");
    c.dispose();
  });

  it("marks the status as error and keeps the draft on save failure", async () => {
    vi.useFakeTimers();
    const { ports } = fakePorts({
      create: () => Promise.resolve({ ok: false, error: "duplicate name" as const }),
    });
    const c = createCardController({
      agent: null,
      savedModel: "",
      isNameTaken: () => false,
      ports,
      onChanged: () => {},
      onRemoved: () => {},
    });
    c.setName("Coding");
    c.setProvider("opencode-1");
    c.setModel("claude");
    await vi.runAllTimersAsync();
    expect(c.save.status).toBe("error");
    expect(c.save.error).toBe("duplicate name");
    expect(c.draft.name).toBe("Coding");
    c.dispose();
  });

  it("guards stale responses: a newer edit is not overwritten by an older save result", async () => {
    vi.useFakeTimers();
    const pending: { resolve: ((r: NamedAgentSaveResult) => void) | null } = { resolve: null };
    const { ports } = fakePorts({
      create: () => new Promise<NamedAgentSaveResult>((res) => (pending.resolve = res)),
    });
    const c = createCardController({
      agent: null,
      savedModel: "",
      isNameTaken: () => false,
      ports,
      onChanged: () => {},
      onRemoved: () => {},
    });
    // Kick a save in flight, then edit again before it resolves.
    c.setName("A");
    c.setProvider("opencode-1");
    c.setModel("claude");
    c.setName("B"); // sequence bumps past the in-flight save
    expect(pending.resolve).not.toBeNull();
    pending.resolve?.({ ok: true, agent: { id: "x", name: "A", model: "opencode-1/claude" } });
    await vi.runAllTimersAsync();
    // The stale "A" create must NOT have applied the old result (saving cleared,
    // but the draft still reads B and no onChanged with "A").
    expect(c.draft.name).toBe("B");
    c.dispose();
  });

  it("remove() on an existing card calls remove and drops via onRemoved", async () => {
    vi.useFakeTimers();
    const existing: NamedAgent = {
      id: "a1",
      name: "Coding",
      model: "opencode-1/claude",
    };
    const { ports, removed } = fakePorts();
    let removedCard = false;
    const c = createCardController({
      agent: existing,
      savedModel: existing.model,
      isNameTaken: () => false,
      ports,
      onChanged: () => {},
      onRemoved: () => (removedCard = true),
    });
    c.remove();
    await vi.runAllTimersAsync();
    expect(removed).toEqual(["a1"]);
    expect(removedCard).toBe(true);
    c.dispose();
  });

  it("remove() on an unsaved draft drops it without a server call", () => {
    vi.useFakeTimers();
    const { ports, removed } = fakePorts();
    let removedCard = false;
    const c = createCardController({
      agent: null,
      savedModel: "",
      isNameTaken: () => false,
      ports,
      onChanged: () => {},
      onRemoved: () => (removedCard = true),
    });
    c.remove();
    expect(removed).toHaveLength(0);
    expect(removedCard).toBe(true);
    c.dispose();
  });
});
