import { describe, expect, it } from "vitest";
import { addPanel, initialPanels, removePanel, selectKind } from "./panels";

describe("view panels reducer", () => {
	it("seeds one empty panel by default", () => {
		const s = initialPanels();
		expect(s.panels).toHaveLength(1);
		expect(s.panels[0]?.kind).toBeNull();
	});

	it("seeds a panel per provided kind, in order, with unique ids", () => {
		const s = initialPanels(["surfaces", null]);
		expect(s.panels.map((p) => p.kind)).toEqual(["surfaces", null]);
		expect(new Set(s.panels.map((p) => p.id)).size).toBe(2);
	});

	it("addPanel appends an empty panel with a fresh id", () => {
		const seed = initialPanels(["surfaces"]);
		const s = addPanel(seed);
		expect(s.panels).toHaveLength(2);
		expect(s.panels[1]?.kind).toBeNull();
		expect(s.panels[1]?.id).not.toBe(s.panels[0]?.id);
	});

	it("addPanel can seed a kind", () => {
		const s = addPanel(initialPanels([null]), "surfaces");
		expect(s.panels[1]?.kind).toBe("surfaces");
	});

	it("removePanel drops the matching id only", () => {
		const seed = initialPanels(["surfaces", null]);
		const firstId = seed.panels[0]?.id ?? -1;
		const s = removePanel(seed, firstId);
		expect(s.panels).toHaveLength(1);
		expect(s.panels[0]?.kind).toBeNull();
	});

	it("selectKind updates only the targeted panel", () => {
		const seed = initialPanels([null, null]);
		const targetId = seed.panels[1]?.id ?? -1;
		const s = selectKind(seed, targetId, "surfaces");
		expect(s.panels[0]?.kind).toBeNull();
		expect(s.panels[1]?.kind).toBe("surfaces");
	});

	it("is pure — never mutates the input state", () => {
		const seed = initialPanels(["surfaces"]);
		const snapshot = JSON.stringify(seed);
		const id = seed.panels[0]?.id ?? -1;
		addPanel(seed);
		removePanel(seed, id);
		selectKind(seed, id, null);
		expect(JSON.stringify(seed)).toBe(snapshot);
	});
});
