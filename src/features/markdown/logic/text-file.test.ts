import { describe, expect, it } from "vitest";
import { splitTextFiles, textFilePath, textFilePreview } from "./text-file";

const reference = (text: string, streaming = false) =>
  splitTextFiles(text, streaming).filter((part) => part.kind === "text-file");
describe("text-file opt-in parser", () => {
  it.each([
    ["[Plan](text-file:notes/plan.md)", "notes/plan.md"],
    ["[Plan](text-file:/tmp/plan.md)", "/tmp/plan.md"],
    ["[Plan](<text-file:notes/my plan.md>)", "notes/my plan.md"],
    ["[Plan](text-file:notes/my%20plan.md)", "notes/my plan.md"],
    ["[Plan](text-file:notes/100%25.md)", "notes/100%.md"],
    ["[Plan](text-file:notes/literal%2520.md)", "notes/literal%20.md"],
    [String.raw`[Plan](text-file:notes/plan\(1\).md)`, "notes/plan(1).md"],
    [String.raw`[Plan](text-file:notes/a\_b.md)`, "notes/a_b.md"],
  ])("parses %s", (text, path) =>
    expect(reference(text)).toEqual([{ kind: "text-file", reference: { label: "Plan", path } }]));
  it.each([
    "[web](https://example.com)",
    "![image](text-file:notes/a.md)",
    "[file](file:///tmp/a.md)",
    "see [Plan](text-file:a.md)",
    "[Plan](text-file:a.md) suffix",
    "`[Plan](text-file:a.md)`",
    "```md\n[Plan](text-file:a.md)\n```",
    "~~~\n[Plan](text-file:a.md)\n~~~",
    "    [Plan](text-file:a.md)",
    "> [Plan](text-file:a.md)",
    "- [Plan](text-file:a.md)",
    "[Plan](text-file:a.md",
    "[Plan](text-file:",
    "[Plan][p]\n\n[p]: text-file:a.md",
    '[Plan](text-file:a.md "title")',
    "<div data-text-file='a.md'>Plan</div>",
  ])("does not opt in: %s", (text) => expect(reference(text)).toEqual([]));
  it.each([
    "file:///tmp/a",
    "https://evil/a",
    "//host/a",
    "~/a",
    "~user/a",
    "a\\b",
    "%00",
    "%0a",
    "%7f",
    "a%5cb",
    "%2f%2fhost/a",
    "%68ttps://evil/a",
    "bad%",
    "",
    " a",
    "a ",
  ])("rejects unsafe path %s", (path) => expect(textFilePath(`text-file:${path}`)).toBeNull());
  it("waits for complete streaming paragraph boundary and keeps settled embeds", () => {
    const complete = "[Plan](text-file:a.md)";
    for (let i = 0; i <= complete.length; i++)
      expect(reference(complete.slice(0, i), true)).toHaveLength(0);
    expect(reference(`${complete}\n`, true)).toHaveLength(0);
    expect(reference(`${complete}\n\n`, true)).toHaveLength(1);
    expect(reference(`${complete}\n\ntail`, true)).toHaveLength(1);
    expect(reference(`${complete} suffix`, true)).toHaveLength(0);
    expect(reference(complete)).toHaveLength(1);
  });
  it("bounds per-message document count", () => {
    const result = splitTextFiles(
      Array.from({ length: 30 }, (_, i) => `[p](text-file:${i}.md)`).join("\n\n"),
    );
    expect(result.filter((p) => p.kind === "text-file")).toHaveLength(8);
    expect(JSON.stringify(result)).toContain("embed limit reached");
  });
});
describe("source-line preview", () => {
  it.each([1, 6, 12])("does not overlap %i source lines", (n) => {
    const text = Array.from({ length: n }, (_, i) => `${i}`).join("\n");
    expect(textFilePreview(text, true)).toEqual({ head: text, tail: "", omitted: 0 });
  });
  it("takes first six and last six source lines, ignoring final newline", () => {
    const result = textFilePreview(
      `${Array.from({ length: 20 }, (_, i) => `line${i + 1}`).join("\n")}\n`,
      true,
    );
    expect(result).toEqual({
      head: "line1\nline2\nline3\nline4\nline5\nline6",
      tail: "line15\nline16\nline17\nline18\nline19\nline20",
      omitted: 8,
    });
  });
  it("restores top-level fence context at fragment edges", () => {
    const text = `\`\`\`js\n${Array.from({ length: 20 }, () => "const x = 1;").join("\n")}\n\`\`\``;
    const result = textFilePreview(text, true);
    expect(result.head).toMatch(/\n```$/);
    expect(result.tail).toMatch(/^```js\n/);
    expect(result.tail).toMatch(/\n```$/);
    expect(textFilePreview(text, false).tail).not.toMatch(/^```js/);
  });
});

describe("text-file parser boundary compatibility", () => {
  it("preserves document-wide ordinary reference definitions across embed splits", () => {
    const parts = splitTextFiles(
      "[before][web]\n\n[Plan](text-file:a.md)\n\n[after][web]\n\n[web]: https://example.com",
    );
    expect(parts.filter((part) => part.kind === "text-file")).toHaveLength(1);
    for (const part of parts) {
      if (part.kind === "markdown") expect(part.text).toContain("[web]: https://example.com");
    }
  });
  it.each([
    "%C2%85",
    "a".repeat(4097),
  ])("rejects backend-unsupported controls or overlong paths", (path) => {
    expect(textFilePath(`text-file:${path}`)).toBeNull();
  });
  it("accepts encoded filename delimiters without treating them as a URL query/fragment", () => {
    expect(textFilePath("text-file:notes/a%23b%3Fc.md")).toBe("notes/a#b?c.md");
  });
});
