import type { ComputerEntry, WorkspaceEntry } from "@dispatch/wire";
import { render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceResult } from "../adapter/http";
import type { WorkspaceStore } from "../store.svelte";
import WorkspaceDetails from "./WorkspaceDetails.svelte";

function fakeEntry(overrides: Partial<WorkspaceEntry> = {}): WorkspaceEntry {
  return {
    id: "my-ws",
    title: "My Workspace",
    defaultCwd: null,
    defaultComputerId: null,
    starred: false,
    archived: false,
    createdAt: 1,
    lastActivityAt: 2,
    conversationCount: 0,
    ...overrides,
  };
}

function fakeStore(): WorkspaceStore {
  return {
    setDefaultCwd: vi.fn(
      async (id: string, defaultCwd: string | null): Promise<WorkspaceResult<WorkspaceEntry>> => ({
        ok: true,
        value: fakeEntry({ id, defaultCwd }),
      }),
    ),
    setDefaultComputer: vi.fn(
      async (
        id: string,
        defaultComputerId: string | null,
      ): Promise<WorkspaceResult<WorkspaceEntry>> => ({
        ok: true,
        value: fakeEntry({ id, defaultComputerId }),
      }),
    ),
  } as unknown as WorkspaceStore;
}

describe("WorkspaceDetails", () => {
  it("renders the title, slug, cwd input, and computer select", () => {
    render(WorkspaceDetails, {
      props: { ws: fakeEntry(), store: fakeStore(), computers: [], onClose: () => {} },
    });
    expect(screen.getByText("My Workspace")).toBeInTheDocument();
    expect(screen.getByText("/my-ws")).toBeInTheDocument();
    expect(screen.getByLabelText("Default working directory")).toBeInTheDocument();
    expect(screen.getByLabelText("Computer")).toBeInTheDocument();
  });

  it("saves the cwd via the store; an empty value clears to null", async () => {
    const user = userEvent.setup();
    const store = fakeStore();
    const onClose = vi.fn();
    render(WorkspaceDetails, {
      props: { ws: fakeEntry({ defaultCwd: "/old" }), store, computers: [], onClose },
    });

    const input = screen.getByLabelText("Default working directory");
    await user.clear(input);
    await user.click(screen.getByRole("button", { name: "Set" }));
    expect(store.setDefaultCwd).toHaveBeenCalledWith("my-ws", null);
  });

  it("a failed cwd save surfaces the error", async () => {
    const user = userEvent.setup();
    const store = fakeStore();
    store.setDefaultCwd = vi.fn(
      async (): Promise<WorkspaceResult<WorkspaceEntry>> => ({ ok: false, error: "nope" }),
    );
    render(WorkspaceDetails, {
      props: { ws: fakeEntry({ defaultCwd: "/old" }), store, computers: [], onClose: () => {} },
    });

    await user.type(screen.getByLabelText("Default working directory"), "!{Enter}");
    expect(await screen.findByText("nope")).toBeInTheDocument();
  });

  it("picking a computer saves it via the store", async () => {
    const user = userEvent.setup();
    const store = fakeStore();
    const computers: ComputerEntry[] = [
      {
        alias: "lab",
        hostName: "lab.example",
        port: 22,
        user: "me",
        identityFile: null,
        knownHost: true,
        usageCount: 0,
      },
    ];
    render(WorkspaceDetails, {
      props: { ws: fakeEntry(), store, computers, onClose: () => {} },
    });

    await user.selectOptions(screen.getByLabelText("Computer"), "lab");
    expect(store.setDefaultComputer).toHaveBeenCalledWith("my-ws", "lab");
  });

  it("the close button dismisses the dialog", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(WorkspaceDetails, {
      props: { ws: fakeEntry(), store: fakeStore(), computers: [], onClose },
    });

    await user.click(screen.getByRole("button", { name: "Close details" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
