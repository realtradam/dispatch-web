import type { ToolEntry } from "../../../core/chunks";

export interface ToolCardView {
  readonly name: string;
  readonly status: "pending" | "ok" | "error";
  readonly callSummary: string;
  readonly callBadges: readonly {
    readonly label: string;
    readonly tone: "success" | "error";
  }[];
  readonly resultSummary: string | null;
  readonly compactResultSummary: string | null;
  readonly callDetail:
    | { readonly kind: "unavailable"; readonly text: string }
    | { readonly kind: "command"; readonly text: string }
    | {
        readonly kind: "edit";
        readonly path: string;
        readonly oldText: string;
        readonly newText: string;
      }
    | {
        readonly kind: "fields";
        readonly fields: readonly {
          readonly key: string;
          readonly value: string;
          readonly multiline: boolean;
        }[];
      };
  readonly output: ToolOutputView | null;
}

export type ToolOutputView =
  | { readonly kind: "full"; readonly lines: readonly string[]; readonly isError: boolean }
  | {
      readonly kind: "elided";
      readonly head: readonly string[];
      readonly hiddenCount: number;
      readonly tail: readonly string[];
      readonly all: readonly string[];
      readonly isError: boolean;
    };

type Args = Readonly<Record<string, unknown>>;
type CallSummary = (args: Args) => string;

function oneLine(text: string, cap = 120): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > cap ? `${compact.slice(0, cap - 1)}…` : compact;
}

function normalize(input: unknown): unknown {
  if (typeof input !== "string") return input;
  try {
    return JSON.parse(input);
  } catch {
    return input;
  }
}

function asArgs(input: unknown): Args {
  return typeof input === "object" && input !== null && !Array.isArray(input)
    ? (input as Args)
    : {};
}

function serialize(input: unknown, pretty = false): string {
  if (typeof input === "string") return input;
  try {
    return JSON.stringify(input, null, pretty ? 2 : undefined) ?? String(input);
  } catch {
    return "[unserializable input]";
  }
}

/** Small scalar arrays are easier to scan inline; nested/long values stay pretty JSON. */
function fieldValue(value: unknown): string {
  if (
    Array.isArray(value) &&
    value.every((item) => item === null || ["string", "number", "boolean"].includes(typeof item))
  ) {
    try {
      const inline = `[${value.map((item) => JSON.stringify(item)).join(", ")}]`;
      if (inline.length <= 80) return inline;
    } catch {
      // Non-wire values still use the safe serializer below.
    }
  }
  return serialize(value, true);
}

function arg(args: Args, ...keys: string[]): string {
  for (const key of keys) {
    const value = Object.hasOwn(args, key) ? args[key] : undefined;
    if (typeof value === "string" && value.trim()) return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
  }
  return "";
}

function lineCount(text: string): number {
  return text === "" ? 0 : outputLines(text).length;
}

/** Drop one final newline terminator, not meaningful blank lines within the output. */
function outputLines(content: string): string[] {
  const normalized = content.replace(/\r\n/g, "\n");
  return normalized === "" ? [] : normalized.replace(/\n$/, "").split("\n");
}

function readSummary(args: Args): string {
  const path = arg(args, "path");
  const offset = typeof args.offset === "number" && Number.isFinite(args.offset) ? args.offset : 1;
  const limit = typeof args.limit === "number" && Number.isFinite(args.limit) ? args.limit : null;
  return `${path}${limit !== null ? `:${offset}-${offset + limit - 1}` : args.offset !== undefined ? `:${offset}` : ""}`;
}

function lspSummary(args: Args): string {
  const line = arg(args, "line");
  const character = arg(args, "character");
  return `${arg(args, "operation")} ${arg(args, "path")}${line ? `:${line}${character ? `:${character}` : ""}` : ""}`;
}

function todoSummary(args: Args): string {
  if (!Array.isArray(args.todos)) return "";
  const done = args.todos.filter((t) => asArgs(t).status === "completed").length;
  return `${args.todos.length} tasks · ${done} completed`;
}

const summarizeAgent: CallSummary = (args) => arg(args, "title", "task", "agent", "model");
const summarizeConversation: CallSummary = (args) => arg(args, "conversationId", "message");

/** Optional built-in polish; all unknown/MCP names use the same generic path. */
const summaries: Readonly<Record<string, CallSummary>> = {
  run_shell: (args) => arg(args, "command"),
  read_file: readSummary,
  edit_file: (args) => arg(args, "path"),
  write_file: (args) => arg(args, "path"),
  web_search: (args) => arg(args, "query", "url"),
  lsp: lspSummary,
  todo_write: todoSummary,
  load_skill: (args) => arg(args, "name"),
  consult_vision: (args) => arg(args, "question", "path"),
  youtube_transcript: (args) => arg(args, "url"),
  summon_agent: summarizeAgent,
  send_agent_message: summarizeConversation,
  read_agent: summarizeConversation,
  open_agent: summarizeConversation,
  cancel_agent_message: summarizeConversation,
  list_agents: (args) => arg(args, "query", "relationship", "workspaceId"),
  list_agent_models: (args) => arg(args, "query"),
};

function detail(name: string, input: unknown, args: Args): ToolCardView["callDetail"] {
  if (name === "run_shell" && typeof args.command === "string") {
    return { kind: "command", text: args.command };
  }
  if (name === "edit_file" && typeof args.path === "string") {
    return {
      kind: "edit",
      path: args.path,
      oldText: typeof args.oldString === "string" ? args.oldString : "",
      newText: typeof args.newString === "string" ? args.newString : "",
    };
  }
  const entries = Object.entries(args);
  return {
    kind: "fields",
    fields: (entries.length > 0 ? entries : [["input", input]]).map(([key, value]) => {
      const text = fieldValue(value);
      return { key: String(key), value: text, multiline: text.includes("\n") };
    }),
  };
}

function bytesLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function responseSummary(name: string, content: string, isError: boolean): string {
  const lines = outputLines(content);
  const first = oneLine(lines.find((line) => line.trim()) ?? "", 72);
  const count = `${lines.length} ${lines.length === 1 ? "line" : "lines"}`;
  const timeout = /\[Command timed out\]/i.test(content);
  const truncated = /\[Output truncated[^\]]*\]/i.test(content);
  let summary: string;
  if (timeout) summary = "timed out";
  else if (isError) summary = "failed";
  else if (!content.trim()) summary = "no output";
  else if (/^\(empty file\b/i.test(content)) summary = "empty file";
  else {
    const replaced =
      name === "edit_file" ? /^Replaced (\d+) occurrence(?:\(s\)|s)?/i.exec(content) : null;
    const written =
      name === "write_file" ? /^(Created|Overwrote)\b[^\n]*\((\d+) bytes\)/i.exec(content) : null;
    if (replaced) {
      summary = `${replaced[1]} ${replaced[1] === "1" ? "replacement" : "replacements"}`;
      if (content.trim().includes("\n")) summary += " · diagnostics";
    } else if (written) {
      summary = `${written[1]?.toLowerCase()} · ${bytesLabel(Number(written[2]))}`;
    } else if (
      name === "run_shell" ||
      name === "read_file" ||
      lines.length > 1 ||
      first.length > 60
    ) {
      summary = count;
    } else summary = first;
  }
  const label = `${summary}${truncated ? " · truncated" : ""}`;
  // Even the wide header must leave room for the call; prefer a whole short
  // fact over chopping an arbitrary one-line response halfway through a word.
  return label.length <= 40 ? label : compactResponseSummary(label, lines.length);
}

/** Never CSS-clip response facts: swap to a whole short fact when space is scarce. */
function compactResponseSummary(summary: string, count: number): string {
  const fact = summary.split(" · ")[0] ?? summary;
  if (/^(failed|timed out|no output|empty file|created|overwrote|\d+ lines?)$/.test(fact))
    return fact;
  if (/^\d+ replacements?$/.test(fact)) return "replaced";
  return `${count} ${count === 1 ? "line" : "lines"}`;
}

export function viewToolEntry(entry: ToolEntry): ToolCardView {
  const input = normalize(entry.call?.input);
  const args = asArgs(input);
  const summarize = Object.hasOwn(summaries, entry.toolName)
    ? summaries[entry.toolName]
    : undefined;
  const generic = arg(
    args,
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
  );
  const builtInSummary = summarize?.(args).trim();
  const callSummary =
    entry.call === null
      ? "Call in earlier history"
      : oneLine(builtInSummary || generic || serialize(input));
  const callBadges: ToolCardView["callBadges"][number][] = [];
  if (entry.toolName === "edit_file" && entry.call !== null) {
    if (typeof args.oldString === "string" && typeof args.newString === "string") {
      callBadges.push(
        { label: `+${lineCount(args.newString)}`, tone: "success" },
        { label: `−${lineCount(args.oldString)}`, tone: "error" },
      );
    }
  }
  const result = entry.result;
  const lines = result === null ? [] : outputLines(result.content);
  const resultSummary =
    result === null ? null : responseSummary(entry.toolName, result.content, result.isError);
  return {
    name: entry.toolName,
    status: result === null ? "pending" : result.isError ? "error" : "ok",
    callSummary,
    callBadges,
    callDetail:
      entry.call === null
        ? {
            kind: "unavailable",
            text: "The call is in earlier, unloaded history. Its response is shown below.",
          }
        : detail(entry.toolName, input, args),
    resultSummary,
    compactResultSummary:
      resultSummary === null ? null : compactResponseSummary(resultSummary, lines.length),
    output:
      result === null
        ? null
        : lines.length <= 12
          ? { kind: "full", lines, isError: result.isError }
          : {
              kind: "elided",
              head: lines.slice(0, 6),
              hiddenCount: lines.length - 12,
              tail: lines.slice(-6),
              all: lines,
              isError: result.isError,
            },
  };
}
