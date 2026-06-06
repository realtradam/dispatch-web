import { describe, expect, it } from "vitest";
import { randomId } from "./uuid";

const V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("randomId", () => {
	it("returns a v4-shaped uuid", () => {
		const id = randomId();
		expect(id).toMatch(V4_RE);
	});

	it("returns distinct values across calls", () => {
		const ids = new Set<string>();
		for (let i = 0; i < 200; i++) {
			ids.add(randomId());
		}
		expect(ids.size).toBe(200);
	});

	it("works without crypto.randomUUID (getRandomValues branch)", () => {
		const origRandomUUID = crypto.randomUUID;
		try {
			// Remove randomUUID so the getRandomValues branch is taken
			delete (crypto as { randomUUID?: () => string }).randomUUID;
			const id = randomId();
			expect(id).toMatch(V4_RE);
		} finally {
			crypto.randomUUID = origRandomUUID;
		}
	});
});
