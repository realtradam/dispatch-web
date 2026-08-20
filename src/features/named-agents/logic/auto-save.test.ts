import { describe, expect, it } from "vitest";
import {
  type AgentDraft,
  draftModel,
  draftValidity,
  isDirty,
  saveStatus,
  saveStatusLabel,
} from "./auto-save";

const draft = (p: Partial<AgentDraft>): AgentDraft => ({
  id: null,
  name: "",
  provider: "",
  model: "",
  ...p,
});

describe("draftModel", () => {
  it("joins provider + model suffix", () => {
    expect(draftModel(draft({ provider: "opencode-1", model: "claude" }))).toBe(
      "opencode-1/claude",
    );
  });

  it("falls back to provider-only when no model", () => {
    expect(draftModel(draft({ provider: "opencode-1" }))).toBe("opencode-1");
  });
});

describe("draftValidity", () => {
  it("is usable when name, provider, and model are all valid", () => {
    const v = draftValidity(draft({ name: "Coding", provider: "opencode-1", model: "claude" }), []);
    expect(v.usable).toBe(true);
    expect(v.message).toBeNull();
  });

  it("is unusable with an empty name / duplicate / missing model", () => {
    expect(draftValidity(draft({ name: "", provider: "p", model: "m" }), []).usable).toBe(false);
    expect(
      draftValidity(draft({ name: "coding", provider: "p", model: "m" }), ["Coding"]).usable,
    ).toBe(false);
    expect(draftValidity(draft({ name: "Coding", provider: "", model: "" }), []).usable).toBe(
      false,
    );
  });

  it("reports the first invalid field's message", () => {
    expect(draftValidity(draft({ name: "", provider: "", model: "" }), []).message).toBe(
      "Name is required.",
    );
    expect(
      draftValidity(draft({ name: "coding", provider: "", model: "" }), ["Coding"]).message,
    ).toBe("A named agent with this name already exists.");
    expect(draftValidity(draft({ name: "Coding", provider: "", model: "" }), []).message).toBe(
      "Select a provider.",
    );
  });
});

describe("isDirty", () => {
  it("is false when the draft matches the saved definition", () => {
    expect(
      isDirty(draft({ name: "Coding", provider: "opencode-1", model: "claude" }), {
        id: "a",
        name: "Coding",
        model: "opencode-1/claude",
      }),
    ).toBe(false);
  });

  it("is true when name or model differ", () => {
    expect(
      isDirty(draft({ name: "Coding X", provider: "opencode-1", model: "claude" }), {
        id: "a",
        name: "Coding",
        model: "opencode-1/claude",
      }),
    ).toBe(true);
    expect(
      isDirty(draft({ name: "Coding", provider: "umans", model: "glm" }), {
        id: "a",
        name: "Coding",
        model: "opencode-1/claude",
      }),
    ).toBe(true);
  });
});

describe("saveStatus", () => {
  const saved = { id: "a", name: "Coding", model: "opencode-1/claude" };

  it("is saved when clean with an id", () => {
    expect(
      saveStatus(
        draft({ id: "a", name: "Coding", provider: "opencode-1", model: "claude" }),
        saved,
        false,
        null,
      ),
    ).toBe("saved");
  });

  it("is dirty when input diverges from the saved definition", () => {
    expect(
      saveStatus(
        draft({ id: "a", name: "Coding X", provider: "opencode-1", model: "claude" }),
        saved,
        false,
        null,
      ),
    ).toBe("dirty");
  });

  it("is an idle draft when it has no id", () => {
    expect(
      saveStatus(
        draft({ name: "Coding", provider: "opencode-1", model: "claude" }),
        { id: null, name: "", model: "" },
        false,
        null,
      ),
    ).toBe("idle");
  });

  it("is saving while a save is in flight", () => {
    expect(
      saveStatus(
        draft({ id: "a", name: "Coding", provider: "opencode-1", model: "claude" }),
        saved,
        true,
        null,
      ),
    ).toBe("saving");
  });

  it("reports an error when the last save failed", () => {
    expect(
      saveStatus(
        draft({ id: "a", name: "Coding", provider: "opencode-1", model: "claude" }),
        saved,
        false,
        "boom",
      ),
    ).toBe("error");
  });
});

describe("saveStatusLabel", () => {
  it("maps every status to a short label", () => {
    expect(saveStatusLabel("idle")).toBe("Not saved");
    expect(saveStatusLabel("dirty")).toBe("Not saved");
    expect(saveStatusLabel("saving")).toBe("Saving…");
    expect(saveStatusLabel("saved")).toBe("Saved");
    expect(saveStatusLabel("error")).toBe("Save failed");
  });
});
