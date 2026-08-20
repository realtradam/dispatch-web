import { render, screen } from "@testing-library/svelte";
import type { UserEvent } from "@testing-library/user-event";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  CreateNamedAgent,
  DeleteNamedAgent,
  NamedAgentInput,
  UpdateNamedAgent,
} from "../logic/types";
import type { NamedAgentPorts } from "./controller.svelte";
import NamedAgentsView from "./NamedAgentsView.svelte";

// ── Fakes for the injected ports (ONLY the outermost edge — no sibling module
// is mocked). A modest `debounceMs` keeps name edits coalesced into one save
// (with 0, each keystroke fires its own update) while provider/model saves stay
// immediate (the model setter dispatches synchronously).
function makePorts(): {
  ports: NamedAgentPorts;
  created: NamedAgentInput[];
  updated: { id: string; input: NamedAgentInput }[];
  removed: string[];
} {
  const created: NamedAgentInput[] = [];
  const updated: { id: string; input: NamedAgentInput }[] = [];
  const removed: string[] = [];
  const ports: NamedAgentPorts = {
    create: (async (input) => {
      created.push(input);
      return { ok: true, agent: { id: `new-${created.length}`, ...input } };
    }) as CreateNamedAgent,
    update: (async (id, input) => {
      updated.push({ id, input });
      return { ok: true, agent: { id, ...input } };
    }) as UpdateNamedAgent,
    remove: (async (id) => {
      removed.push(id);
      return { ok: true } as const;
    }) as DeleteNamedAgent,
    debounceMs: 150,
  };
  return { ports, created, updated, removed };
}

const MODELS = ["opencode-1/claude-sonnet-4.5", "anthropic/sonnet"] as unknown as readonly string[];

const DUP_MESSAGE = "A named agent with this name already exists.";

function renderView() {
  const fakes = makePorts();
  render(NamedAgentsView, { props: { agents: [], models: MODELS, ports: fakes.ports } });
  return fakes;
}

async function addDraft(user: UserEvent): Promise<void> {
  await user.click(screen.getByRole("button", { name: "+ Add Named Agent" }));
}

async function typeName(index: number, name: string): Promise<void> {
  const inputs = screen.getAllByLabelText("Named agent name");
  const input = inputs[index];
  if (input === undefined) throw new Error(`No named-agent name input at index ${index}`);
  await userEvent.setup().clear(input);
  await userEvent.setup().type(input, name);
}

async function completeDraft(index: number): Promise<void> {
  const user = userEvent.setup();
  // Provider first (the model select is disabled until a provider is chosen).
  const providerSelect = screen.getAllByLabelText("Named agent provider")[index];
  if (providerSelect === undefined) throw new Error(`No provider select at index ${index}`);
  await user.selectOptions(providerSelect, "opencode-1");
  const modelSelect = screen.getAllByLabelText("Named agent model")[index];
  if (modelSelect === undefined) throw new Error(`No model select at index ${index}`);
  await user.selectOptions(modelSelect, "claude-sonnet-4.5");
}

afterEach(() => {
  vi.useRealTimers();
});

describe("NamedAgentsView", () => {
  it("a fresh single draft does not self-collide with its own name", async () => {
    renderView();
    await addDraft(userEvent.setup());
    await typeName(0, "Coding Agent");

    // The card is not yet usable (no model) so it shows a model hint, but it
    // must NOT report its own draft name as an existing duplicate.
    await screen.findByText("Select a provider.");
    expect(screen.queryByText(DUP_MESSAGE)).toBeNull();
  });

  it("two drafts with DISTINCT names neither self-collide", async () => {
    const user = userEvent.setup();
    renderView();
    await addDraft(user);
    await typeName(0, "Coding Agent");
    await addDraft(user);
    await typeName(1, "Writer");

    // Each must see the OTHER's name as an other-name, never its OWN.
    expect(screen.queryByText(DUP_MESSAGE)).toBeNull();
  });

  it("two drafts with the SAME name are a genuine sibling collision (each flags it)", async () => {
    const user = userEvent.setup();
    renderView();
    await addDraft(user);
    await typeName(0, "Coding Agent");
    await addDraft(user);
    await typeName(1, "Coding Agent");

    // Duplicate names among DISTINCT rows are invalid — both rows must report it
    // (the self is excluded, but the sibling's identical name is a real collision).
    expect((await screen.findAllByText(DUP_MESSAGE)).length).toBe(2);
  });

  it("saving one of multiple drafts persists only that row (distinct records)", async () => {
    const user = userEvent.setup();
    const fakes = renderView();
    await addDraft(user);
    await typeName(0, "Coding Agent");
    await addDraft(user);
    await typeName(1, "Writer");

    // Both drafts complete to usable cards → each dispatches its OWN create.
    await completeDraft(0);
    await completeDraft(1);

    await vi.waitFor(() => expect(fakes.created).toHaveLength(2));
    expect(fakes.created[0]?.name).toBe("Coding Agent");
    expect(fakes.created[1]?.name).toBe("Writer");
    // Each persisted record got its own server-minted id (a single draft must
    // not clobber its sibling's reconciling to the same record).
    expect(await screen.findAllByText("Saved")).toHaveLength(2);
  });

  it("after a draft persists, a sibling draft does not self-collide and the saved row re-saves on edit", async () => {
    const user = userEvent.setup();
    const fakes = renderView();
    await addDraft(user);
    await typeName(0, "Coding Agent");
    await completeDraft(0);
    await vi.waitFor(() => expect(fakes.created).toHaveLength(1));

    // Add a second draft with a DIFFERENT name. After row 0 is persisted, this
    // still-draft row must not treat its own name as a duplicate.
    await addDraft(user);
    await typeName(1, "Writer");
    expect(screen.queryByText(DUP_MESSAGE)).toBeNull();

    // The saved card's controller now owns a real id → a later edit targets an
    // UPDATE of the SAME row (id new-1), never a fresh create.
    await typeName(0, "Coding Agent X");
    await vi.waitFor(() => expect(fakes.updated.length).toBeGreaterThanOrEqual(1));
    expect(fakes.updated[0]?.id).toBe("new-1");
    expect(fakes.updated[0]?.input.name).toBe("Coding Agent X");
    // Still exactly one create — the edit reconciled, not re-created.
    expect(fakes.created).toHaveLength(1);
  });

  it("removing one of multiple drafts removes only that row", async () => {
    const user = userEvent.setup();
    renderView();
    await addDraft(user);
    await typeName(0, "Coding Agent");
    await addDraft(user);
    await typeName(1, "Writer");

    // Remove the SECOND card — the first must survive.
    const removeButtons = screen.getAllByRole("button", { name: "Remove named agent" });
    const second = removeButtons[1];
    if (second === undefined) throw new Error("Expected a second Remove button");
    await user.click(second);

    const inputs = await screen.findAllByLabelText("Named agent name");
    expect(inputs).toHaveLength(1);
    expect((inputs[0] as HTMLInputElement).value).toBe("Coding Agent");
  });
});
