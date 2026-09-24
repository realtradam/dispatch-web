import { render, screen, waitFor } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { SearchBackendConfig, SearchBackendConfigResult } from "../logic/view-model";
import SearchBackendField from "./SearchBackendField.svelte";

const CONFIG: SearchBackendConfig = {
  backend: "firecrawl",
  available: [
    { id: "firecrawl", label: "Firecrawl (self-hosted)", configured: true },
    { id: "umans", label: "Umans (Exa)", configured: false },
  ],
};

function okLoad(backend = "firecrawl"): () => Promise<SearchBackendConfigResult> {
  return async () => ({ ok: true, config: { ...CONFIG, backend } });
}

function okSave(backend: string): () => Promise<SearchBackendConfigResult> {
  const saves: string[] = [];
  const impl = async (value: string): Promise<SearchBackendConfigResult> => {
    saves.push(value);
    return { ok: true, config: { ...CONFIG, backend: value } };
  };
  // attach the recorder for assertions
  (impl as unknown as { saves: string[] }).saves = saves;
  void backend;
  return impl as () => Promise<SearchBackendConfigResult>;
}

describe("SearchBackendField", () => {
  it("renders the options from the loaded config (unconfigured disabled, None last)", async () => {
    render(SearchBackendField, { props: { load: okLoad(), save: okSave("none") } });
    const select = await screen.findByLabelText("Search backend");
    await waitFor(() => expect(select).toBeEnabled());
    const options = select.querySelectorAll("option");
    const labels = [...options].map((o) => o.textContent);
    expect(labels).toEqual([
      "Firecrawl (self-hosted)",
      "Umans (Exa) (not configured)",
      "None (search disabled)",
    ]);
    expect(options[1]?.disabled).toBe(true);
    expect((select as HTMLSelectElement).value).toBe("firecrawl");
  });

  it("saves on change and shows the saved confirmation with the new label", async () => {
    const user = userEvent.setup();
    const save = okSave("umans");
    render(SearchBackendField, { props: { load: okLoad(), save } });

    const select = (await screen.findByLabelText("Search backend")) as HTMLSelectElement;
    await waitFor(() => expect(select).toBeEnabled());

    // Select the umans entry (disabled here would block it, so flip configured
    // via a custom config below); instead select "none" which is always enabled.
    await user.selectOptions(select, "none");
    await waitFor(() => expect(screen.getByText(/Saved/)).toBeInTheDocument());
    expect(screen.getByText(/Saved: None \(search disabled\)\./)).toBeInTheDocument();
    const saves = (save as unknown as { saves: string[] }).saves;
    expect(saves).toEqual(["none"]);
    expect(select.value).toBe("none");
  });

  it("reverts the selection to the persisted value when the save fails", async () => {
    const user = userEvent.setup();
    const save = async (): Promise<SearchBackendConfigResult> => ({
      ok: false,
      error: "Set search backend failed (HTTP 500)",
    });
    render(SearchBackendField, { props: { load: okLoad(), save } });

    const select = (await screen.findByLabelText("Search backend")) as HTMLSelectElement;
    await waitFor(() => expect(select).toBeEnabled());
    await user.selectOptions(select, "none");

    expect(await screen.findByText(/HTTP 500/)).toBeInTheDocument();
    expect(select.value).toBe("firecrawl");
  });

  it("renders disabled with a 'search not available' hint on the 503 degrade", async () => {
    const load = async (): Promise<SearchBackendConfigResult> => ({
      ok: false,
      error: "Search config failed (HTTP 503)",
      unavailable: true,
    });
    render(SearchBackendField, { props: { load, save: okSave("none") } });
    const select = await screen.findByLabelText("Search backend");
    await waitFor(() => expect(select).toBeDisabled());
    expect(screen.getByText(/Search not available/)).toBeInTheDocument();
    // No help text in the unavailable state (nothing to explain — search is off).
    expect(screen.queryByText(/search.*mode only/i)).not.toBeInTheDocument();
  });

  it("renders a loading skeleton while the initial GET is in flight", async () => {
    let resolveLoad!: (r: SearchBackendConfigResult) => void;
    const load = () =>
      new Promise<SearchBackendConfigResult>((resolve) => {
        resolveLoad = resolve;
      });
    render(SearchBackendField, { props: { load, save: okSave("none") } });
    expect(screen.getByLabelText("Search backend loading")).toBeInTheDocument();
    resolveLoad({ ok: true, config: CONFIG });
    await screen.findByLabelText("Search backend");
  });

  it("prepends an unknown persisted selection as a selectable option", async () => {
    const load = async (): Promise<SearchBackendConfigResult> => ({
      ok: true,
      config: { backend: "gone", available: [] },
    });
    render(SearchBackendField, { props: { load, save: okSave("none") } });
    const select = (await screen.findByLabelText("Search backend")) as HTMLSelectElement;
    await waitFor(() => expect(select).toBeEnabled());
    expect(select.value).toBe("gone");
    const labels = [...select.querySelectorAll("option")].map((o) => o.textContent);
    expect(labels).toEqual(["gone (unknown)", "None (search disabled)"]);
  });
});
