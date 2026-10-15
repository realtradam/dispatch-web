import { describe, expect, it } from "vitest";
import type { ToolEntry } from "../../../core/chunks";
import { toolLabel, viewToolEntry } from "./tool-summary";

function entry(
  name: string,
  input: unknown,
  content: string | null = "ok",
  isError = false,
): ToolEntry {
  return {
    toolCallId: "a",
    toolName: name,
    call: { type: "tool-call", toolCallId: "a", toolName: name, input },
    result:
      content === null
        ? null
        : { type: "tool-result", toolCallId: "a", toolName: name, content, isError },
  };
}

const view = (name: string, input: unknown, content: string | null = "ok", isError = false) =>
  viewToolEntry(entry(name, input, content, isError));
const lines = (n: number) => Array.from({ length: n }, (_, i) => `line ${i + 1}`);

describe("tool labels", () => {
  it.each([
    ["run_shell", "Run command"],
    ["read_file", "Read file"],
    ["edit_file", "Edit file"],
    ["write_file", "Write file"],
    ["web_search", "Web search"],
    ["lsp", "Code intelligence"],
    ["todo_write", "Update to-dos"],
    ["load_skill", "Load skill"],
    ["consult_vision", "Ask vision model"],
    ["read_image", "Read image"],
    ["youtube_transcript", "YouTube transcript"],
    ["summon_agent", "Summon agent"],
    ["send_agent_message", "Message agent"],
    ["read_agent", "Read agent reply"],
    ["open_agent", "Open agent"],
    ["cancel_agent_message", "Cancel agent message"],
    ["list_agents", "List agents"],
    ["list_agent_models", "List agent models"],
  ])("built-in %s → %s", (name, label) => {
    expect(toolLabel(name)).toBe(label);
    expect(view(name, {}).label).toBe(label);
    expect(view(name, {}).name).toBe(name);
  });
  it.each([
    ["github__create_issue", "Github: Create issue"],
    ["mcp__github__create_issue", "Github: Create issue"],
    ["playwright__browserTakeScreenshot", "Playwright: Browser take screenshot"],
    ["scaffold_echo", "Scaffold echo"],
    ["fetchUrl", "Fetch url"],
    ["some-kebab-tool", "Some kebab tool"],
    ["toString", "To string"],
  ])("unknown %s is humanized → %s", (name, label) => {
    expect(toolLabel(name)).toBe(label);
  });
});

describe("tool summaries", () => {
  it.each([
    ["run_shell", { command: "bun run test\n  --run" }, "bun run test --run"],
    ["read_file", { path: "src/a.ts", offset: 5, limit: 80 }, "src/a.ts:5-84"],
    ["read_file", { path: "src/a.ts", limit: 12 }, "src/a.ts:1-12"],
    ["read_file", { path: "src/a.ts", offset: 10 }, "src/a.ts:10"],
    ["read_file", { path: "src/a.ts" }, "src/a.ts"],
    ["edit_file", { path: "src/a.ts", oldString: "a", newString: "b" }, "src/a.ts"],
    ["write_file", { path: "src/a.ts", content: "data" }, "src/a.ts"],
    ["web_search", { query: "svelte 5 runes", url: "ignored" }, "svelte 5 runes"],
    ["web_search", { url: "https://example.org", mode: "scrape" }, "https://example.org"],
    [
      "lsp",
      { operation: "references", path: "src/a.ts", line: 12, character: 3 },
      "references src/a.ts:12:3",
    ],
    ["lsp", { operation: "diagnostics", path: "src/a.ts" }, "diagnostics src/a.ts"],
    [
      "todo_write",
      { todos: [{ status: "pending" }, { status: "completed" }, null] },
      "3 tasks · 1 completed",
    ],
    ["load_skill", { name: "research_methodology" }, "research_methodology"],
    [
      "consult_vision",
      { question: "What is in this picture?", imageIds: [1] },
      "What is in this picture?",
    ],
    ["youtube_transcript", { url: "https://youtu.be/abc" }, "https://youtu.be/abc"],
    ["summon_agent", { title: "Review", task: "long task", agent: "Opus" }, "Review"],
    ["summon_agent", { task: "Review the patch" }, "Review the patch"],
    ["summon_agent", { agent: "Opus" }, "Opus"],
    ["send_agent_message", { conversationId: "abcd", message: "Continue" }, "abcd"],
    ["read_agent", { conversationId: "abcd" }, "abcd"],
    ["open_agent", { conversationId: "abcd" }, "abcd"],
    ["cancel_agent_message", { conversationId: "abcd", messageId: "m1" }, "abcd"],
    ["list_agents", { relationship: "descendants" }, "descendants"],
    ["list_agents", { query: "review" }, "review"],
    ["list_agent_models", { query: "Opus" }, "Opus"],
  ])("%s derives a meaningful call summary from %j", (name, input, expected) => {
    expect(view(name, input).callSummary).toBe(expected);
  });

  it("formats edit call badges and old/new details without hiding multiline text", () => {
    const input = { path: "a.ts", oldString: "a\nb\n", newString: "x\ny\nz\n" };
    const card = view("edit_file", input);
    expect(card.callBadges).toEqual([
      { label: "+3", tone: "success" },
      { label: "−2", tone: "error" },
    ]);
    expect(card.callDetail).toEqual({
      kind: "edit",
      path: "a.ts",
      oldText: input.oldString,
      newText: input.newString,
    });
    expect(view("edit_file", { path: "a", oldString: "", newString: "x" }).callBadges).toEqual([
      { label: "+1", tone: "success" },
      { label: "−0", tone: "error" },
    ]);
    expect(view("edit_file", { path: "a" }).callBadges).toEqual([]);
  });
  it("omits edit diffstats after failure while retaining attempted edits in call details", () => {
    const input = { path: "src/missing.ts", oldString: "foo", newString: "bar" };
    const card = view("edit_file", input, "Error: oldString not found", true);
    expect(card.callBadges).toEqual([]);
    expect(card.callDetail).toEqual({
      kind: "edit",
      path: input.path,
      oldText: "foo",
      newText: "bar",
    });
    expect(card.resultSummary).toBe("failed");
  });
  it("preserves exact shell commands in the expanded detail", () => {
    expect(view("run_shell", { command: "ls\n pwd" }).callDetail).toEqual({
      kind: "command",
      text: "ls\n pwd",
    });
  });
  it("shows scalar fields and pretty nested JSON", () => {
    expect(view("mcp__foo", { path: "a.ts", count: 2, nested: { a: true } }).callDetail).toEqual({
      kind: "fields",
      fields: [
        { key: "path", value: "a.ts", multiline: false },
        { key: "count", value: "2", multiline: false },
        { key: "nested", value: '{\n  "a": true\n}', multiline: true },
      ],
    });
  });
  it("formats short scalar arrays inline, retaining quotes, escapes, nulls and empty arrays", () => {
    expect(
      view("mcp", {
        labels: ["ui", "chat"],
        scalars: [1, true, null],
        empty: [],
        escaped: ["a\nb"],
      }).callDetail,
    ).toEqual({
      kind: "fields",
      fields: [
        { key: "labels", value: '["ui", "chat"]', multiline: false },
        { key: "scalars", value: "[1, true, null]", multiline: false },
        { key: "empty", value: "[]", multiline: false },
        { key: "escaped", value: '["a\\nb"]', multiline: false },
      ],
    });
  });
  it("keeps long arrays and nested structures pretty-printed and complete", () => {
    const input = { long: ["x".repeat(80)], nested: [{ a: 1 }], mixed: [1, { a: 1 }] };
    const card = view("mcp", input);
    if (card.callDetail.kind !== "fields") throw new Error("expected fields");
    expect(card.callDetail.fields.map((field) => field.multiline)).toEqual([true, true, true]);
    expect(card.callDetail.fields.map((field) => JSON.parse(field.value))).toEqual(
      Object.values(input),
    );
  });
  it.each([
    "command",
    "path",
    "file_path",
    "query",
    "url",
    "pattern",
    "name",
    "question",
    "title",
    "task",
    "message",
    "conversationId",
  ])("generic fallback recognizes %s", (key) => {
    expect(view("mcp__foo", { [key]: "target" }).callSummary).toBe("target");
  });
  it("generic fallback prefers the first meaningful argument, else readable key: value pairs", () => {
    expect(view("mcp__foo", { command: " ", path: "a", query: "b" }).callSummary).toBe("a");
    expect(view("mcp__foo", { a: 1, b: "x" }).callSummary).toBe("a: 1 · b: x");
    // Only nested values → no summary rather than a JSON dump.
    expect(view("mcp__foo", { opts: { deep: true } }).callSummary).toBe("");
  });
  it.each([
    "not JSON",
    "{bad",
    42,
    true,
    [1, "a"],
    '"hi"',
  ])("tolerates malformed/non-object input %j", (input) => {
    expect(() => view("read_file", input)).not.toThrow();
    expect(view("read_file", input).callSummary).not.toBe("");
    expect(view("read_file", input).callDetail.kind).toBe("fields");
  });
  it.each([
    null,
    undefined,
    {},
    [],
    "",
    "  ",
    "null",
    "{}",
  ])("an argument-less call (%j) shows no summary and a 'no arguments' detail — never `{}`", (input) => {
    const card = view("list_agent_models", input);
    expect(card.callSummary).toBe("");
    expect(card.callDetail).toEqual({ kind: "none" });
  });
  it.each([
    "run_shell",
    "read_file",
    "edit_file",
    "write_file",
    "web_search",
    "lsp",
    "todo_write",
    "load_skill",
    "consult_vision",
    "youtube_transcript",
    "summon_agent",
    "read_agent",
  ])("%s falls back safely for missing arguments", (name) => {
    for (const input of [null, undefined, {}]) {
      expect(() => view(name, input)).not.toThrow();
      expect(view(name, input).callSummary).toBe("");
      expect(view(name, input).callDetail).toEqual({ kind: "none" });
    }
    expect(view(name, "{bad").callSummary).toBe("{bad");
  });
  it("parses JSON-string inputs", () => {
    const card = view("run_shell", '{"command":"bun run test"}');
    expect(card.callSummary).toBe("bun run test");
    expect(card.callDetail).toEqual({ kind: "command", text: "bun run test" });
  });
  it("handles unexpected built-in argument types and prototype-looking tool names", () => {
    expect(view("todo_write", { todos: "wrong" }).callSummary).toBe("todos: wrong");
    expect(view("run_shell", { command: { nested: true } }).callDetail.kind).toBe("fields");
    expect(view("constructor", { path: "a" }).callSummary).toBe("a");
    expect(view("__proto__", {}).callSummary).toBe("");
    expect(view("__proto__", {}).label).toBe("Proto");
    expect(
      view("mcp", JSON.parse('{"__proto__":{"command":"bad"},"path":"good"}')).callSummary,
    ).toBe("good");
  });
  it("does not throw on unserializable input", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(view("mcp", cyclic).callSummary).toBe("");
    expect(view("mcp", cyclic).callDetail).toEqual({
      kind: "fields",
      fields: [{ key: "self", value: "[unserializable input]", multiline: false }],
    });
    expect(() => view("mcp", { integer: 1n })).not.toThrow();
  });
  it("caps and whitespace-collapses header strings but retains full detail", () => {
    const command = `  echo\n${"x".repeat(300)}`;
    const card = view("run_shell", { command });
    expect(card.callSummary.length).toBe(120);
    expect(card.callSummary.endsWith("…")).toBe(true);
    expect(card.callSummary).not.toMatch(/\n/);
    expect(card.callDetail).toEqual({ kind: "command", text: command });
  });
  it("represents pending entries with no response summary/output", () => {
    expect(view("run_shell", { command: "sleep 1" }, null)).toMatchObject({
      status: "pending",
      resultSummary: null,
      output: null,
    });
  });
  it("represents orphan results with unknown call details, not pending", () => {
    const e = { ...entry("read_file", {}, "data"), call: null };
    expect(viewToolEntry(e)).toMatchObject({
      name: "read_file",
      status: "ok",
      callSummary: "Call in earlier history",
      resultSummary: "1 line",
    });
    expect(viewToolEntry(e).callDetail).toEqual({
      kind: "unavailable",
      text: "This call is earlier in the conversation. Show earlier messages to see it.",
    });
  });
});

describe("tool response facts", () => {
  it.each([
    ["run_shell", "one\ntwo\n", false, "2 lines"],
    ["run_shell", "done", false, "1 line"],
    ["read_file", "1\tfile text\n", false, "1 line"],
    ["read_file", "(empty file: a.ts)", false, "empty file"],
    ["mcp", "", false, "no output"],
    ["mcp", " \n\t", false, "no output"],
    ["mcp", "a short response", false, "a short response"],
    ["mcp", "A successful response with more than forty characters of text", false, "1 line"],
    ["mcp", "x".repeat(200), false, "1 line"],
    ["web_search", "a\nb\nc", false, "3 lines"],
    ["run_shell", "", true, "failed"],
    ["mcp", "Permission denied", true, "failed"],
    ["run_shell", "error\ndetail", true, "failed"],
    ["run_shell", "partial\n\n[Command timed out]", true, "timed out"],
    ["run_shell", "[Output truncated: 12000 bytes]", false, "1 line · truncated"],
    ["run_shell", "bad\n[Output truncated: 12000 bytes]", true, "failed · truncated"],
    ["edit_file", 'Replaced 1 occurrence(s) in "a.ts".', false, "1 replacement"],
    [
      "edit_file",
      'Replaced 3 occurrences in "a.ts".\n\nLSP diagnostics: error at line 2',
      false,
      "3 replacements · diagnostics",
    ],
    ["write_file", 'Created "a.ts" (4200 bytes).', false, "created · 4.1 KB"],
    ["write_file", 'Overwrote "a.ts" (10 bytes).', false, "overwrote · 10 B"],
    ["write_file", 'Created "a.ts" (1048576 bytes).', false, "created · 1.0 MB"],
  ])("%s summarizes %j (error=%s)", (name, content, isError, expected) => {
    const card = view(name, {}, content, isError);
    expect(card.resultSummary).toBe(expected);
    expect(card.status).toBe(isError ? "error" : "ok");
    expect(card.output?.isError).toBe(isError);
  });
  it.each([
    ["run_shell", "oops\ndetails", true, "failed"],
    ["run_shell", "partial\n[Command timed out]", true, "timed out"],
    ["write_file", 'Created "a.ts" (4200 bytes).', false, "created"],
    ["write_file", 'Overwrote "a.ts" (10 bytes).', false, "overwrote"],
    ["edit_file", 'Replaced 3 occurrences in "a.ts".\nDiagnostics: warning', false, "replaced"],
    ["run_shell", "a\nb\nc\nd", false, "4 lines"],
    ["mcp", "Created issue #42", false, "1 line"],
    ["mcp", "", false, "no output"],
    ["read_file", "(empty file: a.ts)", false, "empty file"],
  ])("%s supplies a complete compact response fact", (name, content, isError, expected) => {
    expect(view(name, {}, content, isError).compactResultSummary).toBe(expected);
  });
  it("never puts error content in header summaries, but retains it verbatim in output", () => {
    const content = 'Error: oldString not found in content of "src/missing.ts".';
    const card = view("edit_file", { path: "src/missing.ts" }, content, true);
    expect(card.resultSummary).toBe("failed");
    expect(card.compactResultSummary).toBe("failed");
    expect(card.output).toEqual({ kind: "full", lines: [content], isError: true });
    expect(card.callSummary).toBe("src/missing.ts");
    expect(view("mcp", {}, null).compactResultSummary).toBeNull();
  });
  it("does not infer success on an error that resembles a write result", () => {
    expect(view("write_file", {}, 'Created "a.ts" (10 bytes).', true).resultSummary).toMatch(
      /^failed/,
    );
  });
});

describe("tool output elision", () => {
  it.each([0, 1, 6, 11, 12])("shows %i lines in full", (n) => {
    expect(view("mcp", {}, lines(n).join("\n")).output).toEqual({
      kind: "full",
      lines: lines(n),
      isError: false,
    });
  });
  it.each([
    13, 14, 100,
  ])("shows first/last six of %i lines, retaining everything for expansion", (n) => {
    expect(view("mcp", {}, lines(n).join("\n"), true).output).toEqual({
      kind: "elided",
      head: lines(n).slice(0, 6),
      hiddenCount: n - 12,
      tail: lines(n).slice(-6),
      all: lines(n),
      isError: true,
    });
  });
  it("ignores one final newline terminator at the 12/13 boundary (including CRLF)", () => {
    expect(view("mcp", {}, `${lines(12).join("\r\n")}\r\n`).output?.kind).toBe("full");
    expect(view("mcp", {}, `${lines(13).join("\n")}\n`).output).toMatchObject({
      kind: "elided",
      hiddenCount: 1,
    });
  });
  it("preserves meaningful blank lines including an extra trailing blank line", () => {
    expect(view("mcp", {}, "a\n\nb\n\n").output).toEqual({
      kind: "full",
      lines: ["a", "", "b", ""],
      isError: false,
    });
  });
});
