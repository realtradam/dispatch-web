import { describe, expect, it } from "vitest";
import {
  buildSearchBackendOptions,
  NONE_BACKEND_ID,
  NONE_BACKEND_LABEL,
  normalizeSearchBackendConfig,
  type SearchBackendConfig,
  searchBackendChanged,
  searchBackendLabel,
} from "./view-model";

const CONFIG: SearchBackendConfig = {
  backend: "firecrawl",
  available: [
    { id: "firecrawl", label: "Firecrawl (self-hosted)", configured: true },
    { id: "umans", label: "Umans (Exa)", configured: true },
  ],
};

describe("buildSearchBackendOptions", () => {
  it("lists the available backends in wire order plus the None off state last", () => {
    expect(buildSearchBackendOptions(CONFIG)).toEqual([
      { id: "firecrawl", label: "Firecrawl (self-hosted)", disabled: false },
      { id: "umans", label: "Umans (Exa)", disabled: false },
      { id: "none", label: NONE_BACKEND_LABEL, disabled: false },
    ]);
  });

  it("disables unconfigured backends with a suffix (listed, never an error)", () => {
    const config: SearchBackendConfig = {
      backend: "firecrawl",
      available: [
        { id: "firecrawl", label: "Firecrawl (self-hosted)", configured: true },
        { id: "umans", label: "Umans (Exa)", configured: false },
      ],
    };
    const options = buildSearchBackendOptions(config);
    expect(options[1]).toEqual({
      id: "umans",
      label: "Umans (Exa) (not configured)",
      disabled: true,
    });
    expect(options[2]?.id).toBe(NONE_BACKEND_ID);
  });

  it("prepends an unknown persisted selection so the select can render it", () => {
    const config: SearchBackendConfig = { backend: "gone", available: [] };
    const options = buildSearchBackendOptions(config);
    expect(options[0]).toEqual({ id: "gone", label: "gone (unknown)", disabled: false });
    expect(options.at(-1)?.id).toBe(NONE_BACKEND_ID);
  });

  it("does not duplicate the none option when 'none' is selected", () => {
    const config: SearchBackendConfig = { backend: NONE_BACKEND_ID, available: [] };
    const options = buildSearchBackendOptions(config);
    expect(options.filter((o) => o.id === NONE_BACKEND_ID)).toHaveLength(1);
  });
});

describe("searchBackendLabel", () => {
  it("maps a backend id to its advertised label", () => {
    expect(searchBackendLabel(CONFIG, "umans")).toBe("Umans (Exa)");
  });

  it("maps 'none' to the off-state label", () => {
    expect(searchBackendLabel(CONFIG, NONE_BACKEND_ID)).toBe(NONE_BACKEND_LABEL);
  });

  it("falls back to the raw id for an unknown backend", () => {
    expect(searchBackendLabel(CONFIG, "gone")).toBe("gone");
  });
});

describe("searchBackendChanged", () => {
  it("detects a real change and a no-op reselect", () => {
    expect(searchBackendChanged("umans", "firecrawl")).toBe(true);
    expect(searchBackendChanged("firecrawl", "firecrawl")).toBe(false);
    expect(searchBackendChanged(NONE_BACKEND_ID, NONE_BACKEND_ID)).toBe(false);
  });
});

describe("normalizeSearchBackendConfig", () => {
  it("normalizes a well-formed response", () => {
    expect(
      normalizeSearchBackendConfig({
        backend: "umans",
        available: [{ id: "firecrawl", label: "Firecrawl (self-hosted)", configured: true }],
      }),
    ).toEqual({
      backend: "umans",
      available: [{ id: "firecrawl", label: "Firecrawl (self-hosted)", configured: true }],
    });
  });

  it("degrades a malformed/partial response instead of crashing the renderer", () => {
    expect(normalizeSearchBackendConfig(null)).toEqual({ backend: NONE_BACKEND_ID, available: [] });
    expect(normalizeSearchBackendConfig({})).toEqual({ backend: NONE_BACKEND_ID, available: [] });
    expect(
      normalizeSearchBackendConfig({
        backend: "firecrawl",
        available: [null, 42, { id: "" }, { label: "no id" }, { id: "umans" }],
      }),
    ).toEqual({
      backend: "firecrawl",
      available: [{ id: "umans", label: "umans", configured: false }],
    });
  });
});
