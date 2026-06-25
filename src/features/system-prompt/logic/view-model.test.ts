import type { SystemPromptVariable } from "@dispatch/transport-contract";
import { describe, expect, it } from "vitest";
import {
	buildIfNotTag,
	buildIfTag,
	buildTag,
	groupVariables,
	insertTag,
	isDynamicVariable,
} from "./view-model";

describe("system-prompt view-model", () => {
	describe("buildTag", () => {
		it("builds a variable placeholder", () => {
			expect(buildTag("system", "time")).toBe("[system:time]");
		});
	});

	describe("buildIfTag", () => {
		it("builds an opening conditional tag", () => {
			expect(buildIfTag("file", "AGENTS.md")).toBe("[if file:AGENTS.md]");
		});
	});

	describe("buildIfNotTag", () => {
		it("builds a negated opening conditional tag", () => {
			expect(buildIfNotTag("prompt", "cwd")).toBe("[if !prompt:cwd]");
		});
	});

	describe("insertTag", () => {
		it("inserts a tag at the cursor position", () => {
			expect(insertTag("Hello world", "[system:time]", 5, 5)).toEqual({
				template: "Hello[system:time] world",
				cursor: 18,
			});
		});

		it("replaces the selected text", () => {
			const tag = buildTag("file", "README.md");
			expect(insertTag("Hello world", tag, 6, 11)).toEqual({
				template: `Hello ${tag}`,
				cursor: 6 + tag.length,
			});
		});

		it("inserts at the end", () => {
			const tag = buildTag("git", "branch");
			expect(insertTag("", tag, 0, 0)).toEqual({
				template: tag,
				cursor: tag.length,
			});
		});
	});

	describe("groupVariables", () => {
		it("groups by type in first-appearing order", () => {
			const variables: SystemPromptVariable[] = [
				{ type: "system", name: "time", description: "" },
				{ type: "prompt", name: "cwd", description: "" },
				{ type: "system", name: "date", description: "" },
				{ type: "git", name: "branch", description: "" },
			];
			const groups = groupVariables(variables);
			expect(groups.map((g) => g.type)).toEqual(["system", "prompt", "git"]);
			expect(groups[0]?.variables.map((v) => v.name)).toEqual(["time", "date"]);
			expect(groups[1]?.variables.map((v) => v.name)).toEqual(["cwd"]);
			expect(groups[2]?.variables.map((v) => v.name)).toEqual(["branch"]);
		});

		it("returns an empty array when no variables", () => {
			expect(groupVariables([])).toEqual([]);
		});
	});

	describe("isDynamicVariable", () => {
		it("returns true when dynamic is true", () => {
			expect(
				isDynamicVariable({ type: "file", name: "path", description: "", dynamic: true }),
			).toBe(true);
		});

		it("returns false when dynamic is missing or false", () => {
			expect(isDynamicVariable({ type: "system", name: "time", description: "" })).toBe(false);
			expect(
				isDynamicVariable({ type: "system", name: "time", description: "", dynamic: false }),
			).toBe(false);
		});
	});
});
