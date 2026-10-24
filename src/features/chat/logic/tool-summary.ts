import type { ToolEntry } from "../../../core/chunks";

export interface ToolCardView {
  /** The raw wire tool name (tooltip / debugging). */
  readonly name: string;
  /** English display name, e.g. `run_shell` → "Run command" (see {@link toolLabel}). */
  readonly label: string;
  /** Which icon the card shows — a semantic key; the UI maps it to a Phosphor icon. */
  readonly icon: ToolIconKey;
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
    /** The call took no arguments (`{}` / absent input) — rendered as a muted note. */
    | { readonly kind: "none" }
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
    // Detect ancestor cycles before the native serializer recurses. Bun's
    // pretty JSON cycle detection can otherwise consume seconds of UI time.
    // Track ancestors, not every visited object: shared non-cyclic values are valid.
    const ancestors: object[] = [];
    return (
      JSON.stringify(
        input,
        function (this: unknown, _key, value: unknown) {
          if (value !== null && typeof value === "object") {
            while (ancestors.length && ancestors.at(-1) !== this) ancestors.pop();
            if (ancestors.includes(value)) throw new TypeError("Circular tool input");
            ancestors.push(value);
          }
          return value;
        },
        pretty ? 2 : undefined,
      ) ?? String(input)
    );
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

/** English names for Dispatch's built-in tools; anything else goes through {@link humanize}. */
const TOOL_LABELS: Readonly<Record<string, string>> = {
  run_shell: "Run command",
  read_file: "Read file",
  edit_file: "Edit file",
  write_file: "Write file",
  web_search: "Web search",
  lsp: "Code intelligence",
  todo_write: "Update to-dos",
  load_skill: "Load skill",
  consult_vision: "Ask vision model",
  read_image: "Read image",
  youtube_transcript: "YouTube transcript",
  summon_agent: "Summon agent",
  send_agent_message: "Message agent",
  read_agent: "Read agent reply",
  open_agent: "Open agent",
  cancel_agent_message: "Cancel agent message",
  list_agents: "List agents",
  list_agent_models: "List agent models",
};

/**
 * Semantic icon keys (Svelte-free; `ui/tool-icons.ts` maps each to a Phosphor
 * component). Unknown tools get `mcp` when namespaced `<server>__<tool>`,
 * else the generic `tool` wrench.
 */
export type ToolIconKey =
  | "terminal"
  | "file-read"
  | "file-edit"
  | "file-write"
  | "search"
  | "code"
  | "todos"
  | "skill"
  | "vision"
  | "image"
  | "youtube"
  | "agent-summon"
  | "agent-send"
  | "agent-read"
  | "agent-open"
  | "agent-cancel"
  | "agents"
  | "models"
  | "mcp"
  | "tool";

const TOOL_ICONS: Readonly<Record<string, ToolIconKey>> = {
  run_shell: "terminal",
  read_file: "file-read",
  edit_file: "file-edit",
  write_file: "file-write",
  web_search: "search",
  lsp: "code",
  todo_write: "todos",
  load_skill: "skill",
  consult_vision: "vision",
  read_image: "image",
  youtube_transcript: "youtube",
  summon_agent: "agent-summon",
  send_agent_message: "agent-send",
  read_agent: "agent-read",
  open_agent: "agent-open",
  cancel_agent_message: "agent-cancel",
  list_agents: "agents",
  list_agent_models: "models",
};

/** The icon key for a tool (built-in table, else MCP plug / generic wrench). */
export function toolIcon(name: string): ToolIconKey {
  if (Object.hasOwn(TOOL_ICONS, name)) return TOOL_ICONS[name] ?? "tool";
  return name.split("__").filter((p) => p !== "").length >= 2 ? "mcp" : "tool";
}

/** `create_issue` / `createIssue` / `create-issue` → "Create issue". */
function sentenceCase(raw: string): string {
  const words = raw
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[\s_\-.]+/)
    .filter((w) => w !== "")
    .map((w) => w.toLowerCase());
  if (words.length === 0) return raw;
  const text = words.join(" ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Generic English name for an unknown tool. MCP tools arrive namespaced as
 * `<serverId>__<toolName>` (backend `mcp/registry.ts`), shown as "Server: Tool name".
 */
function humanize(name: string): string {
  const parts = name.split("__").filter((p) => p !== "");
  if (parts[0]?.toLowerCase() === "mcp" && parts.length > 1) parts.shift();
  if (parts.length >= 2) {
    const server = sentenceCase(parts[0] ?? "");
    return `${server}: ${sentenceCase(parts.slice(1).join(" "))}`;
  }
  return sentenceCase(name);
}

/** The English display name for a tool (built-in table, else humanized). */
export function toolLabel(name: string): string {
  return Object.hasOwn(TOOL_LABELS, name) ? (TOOL_LABELS[name] ?? name) : humanize(name);
}

/** True for input that carries no arguments at all (absent, `null`, `{}`, `[]`, blank string). */
function isEmptyInput(input: unknown): boolean {
  if (input === undefined || input === null) return true;
  if (typeof input === "string") return input.trim() === "";
  if (Array.isArray(input)) return input.length === 0;
  return typeof input === "object" && Object.keys(input).length === 0;
}

/** Fallback summary: scalar args as `key: value` (never raw JSON braces). */
function scalarPairs(args: Args): string {
  return Object.entries(args)
    .filter(
      ([, v]) => ["string", "number", "boolean"].includes(typeof v) && String(v).trim() !== "",
    )
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join(" · ");
}

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
  if (isEmptyInput(input)) return { kind: "none" };
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
      ? entry.recovering
        ? "Recovering tool input…"
        : "Call in earlier history"
      : isEmptyInput(input)
        ? ""
        : oneLine(
            builtInSummary ||
              generic ||
              scalarPairs(args) ||
              // Non-object input (e.g. a bare string); objects with only nested
              // values stay unsummarized rather than dumping JSON braces.
              (Object.keys(args).length === 0 ? serialize(input) : ""),
          );
  const callBadges: ToolCardView["callBadges"][number][] = [];
  if (entry.toolName === "edit_file" && entry.call !== null && !entry.result?.isError) {
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
    label: toolLabel(entry.toolName),
    icon: toolIcon(entry.toolName),
    status: result === null ? "pending" : result.isError ? "error" : "ok",
    callSummary,
    callBadges,
    callDetail:
      entry.call === null
        ? {
            kind: "unavailable",
            text: entry.recovering
              ? "Tool input is unavailable until it is persisted. Recovering from conversation history…"
              : "This call is earlier in the conversation. Show earlier messages to see it.",
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
