import { Marked } from "marked";

export interface TextFileReference {
  readonly label: string;
  readonly path: string;
}
export type MarkdownPart =
  | { readonly kind: "markdown"; readonly text: string }
  | { readonly kind: "text-file"; readonly reference: TextFileReference };

/** Input is marked's already Markdown-unescaped href. Decode percent escapes ONCE. */
export function textFilePath(href: string): string | null {
  if (!href.startsWith("text-file:")) return null;
  let path: string;
  try {
    path = decodeURIComponent(href.slice(10));
  } catch {
    return null;
  }
  if (
    !path ||
    path !== path.trim() ||
    path.length > 4096 ||
    path.includes("\\") ||
    Array.from(path).some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || (code >= 127 && code <= 159);
    }) ||
    path.startsWith("~") ||
    path.startsWith("//") ||
    /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(path)
  )
    return null;
  return path;
}

/** Only a complete, top-level, standalone inline-link paragraph opts in. No I/O. */
export function splitTextFiles(text: string, streaming = false): readonly MarkdownPart[] {
  if (!text.includes("text-file:")) return [{ kind: "markdown", text }];
  const parts: MarkdownPart[] = [];
  let prose = "";
  let offset = 0;
  let embeds = 0;
  const tokens = new Marked({ gfm: true }).lexer(text);
  for (const token of tokens) {
    offset += token.raw.length;
    const children = token.type === "paragraph" ? token.tokens : undefined;
    const link = children?.length === 1 ? children[0] : undefined;
    const path =
      link?.type === "link" &&
      link.title === null &&
      // Reference-style links and multiline paragraphs are deliberately not embeds.
      /^\s*\[[\s\S]*\]\(/.test(token.raw) &&
      !token.raw.trim().includes("\n")
        ? textFilePath(link.href)
        : null;
    // During streaming wait for a paragraph boundary, not merely a closing ')'
    // that could still grow into adjacent prose on the next delta.
    const settled = !streaming || /^\s*\n/.test(text.slice(offset));
    if (path !== null && link?.type === "link" && settled && embeds < 8) {
      embeds++;
      if (prose) parts.push({ kind: "markdown", text: prose });
      prose = "";
      parts.push({ kind: "text-file", reference: { label: link.text, path } });
    } else {
      prose += token.raw;
      if (path !== null && settled && embeds >= 8)
        prose += "\n\n_Text-file embed limit reached (8 per message)._\n\n";
    }
  }
  if (prose) parts.push({ kind: "markdown", text: prose });
  // Reference definitions apply document-wide, even across embed boundaries.
  const definitions = tokens
    .filter((token) => token.type === "def")
    .map((token) => token.raw)
    .join("\n");
  return embeds && definitions
    ? parts.map((part) =>
        part.kind === "markdown"
          ? {
              ...part,
              text: `${part.text}\n\n${definitions}`,
            }
          : part,
      )
    : parts;
}

/** Restore top-level fence context when the tail begins inside a code fence. */
function fenceAt(lines: readonly string[], end: number): string | null {
  let fence: { marker: string; info: string } | null = null;
  for (const line of lines.slice(0, end)) {
    if (fence) {
      const close = /^ {0,3}(`+|~+)\s*$/.exec(line)?.[1];
      if (close && close[0] === fence.marker[0] && close.length >= fence.marker.length)
        fence = null;
    } else {
      const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
      if (match?.[1]) fence = { marker: match[1], info: match[2] ?? "" };
    }
  }
  return fence ? `${fence.marker}${fence.info}` : null;
}
export function textFilePreview(text: string, markdown: boolean) {
  const lines = text.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
  if (lines.length <= 12) return { head: text, tail: "", omitted: 0 };
  const headLines = lines.slice(0, 6);
  const tailLines = lines.slice(-6);
  const headFence = markdown ? fenceAt(lines, 6) : null;
  const tailFence = markdown ? fenceAt(lines, lines.length - 6) : null;
  return {
    head: headLines.join("\n") + (headFence ? `\n${headFence.match(/^[`~]+/)?.[0]}` : ""),
    tail: (tailFence ? `${tailFence}\n` : "") + tailLines.join("\n"),
    omitted: lines.length - 12,
  };
}
