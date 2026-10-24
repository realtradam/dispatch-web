import { type ChildProcess, spawn } from "node:child_process";
import { rm, writeFile } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";
import { createInterface } from "node:readline";
import { fireEvent, render, screen } from "@testing-library/svelte";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTextFileClient, Markdown } from "../src/features/markdown";

interface Fixture {
  url: string;
  path: string;
  cwd: string;
  conversationId: string;
  remoteConversationId: string;
}

// Opt-in real cross-repo UI/network probe. Owns an ephemeral loopback server and
// temporary files only; never connects to or restarts the deployed application.
// bun run test:text-file-live
// The backend must be installed and typechecked first (workspace public dists).
describe.skipIf(process.env.TEXT_FILE_LIVE_PROBE !== "1")("live saved-file chat display", () => {
  let child: ChildProcess;
  let fixture: Fixture;
  beforeAll(async () => {
    fixture = await new Promise<Fixture>((resolve, reject) => {
      child = spawn("bun", ["packages/transport-http/src/text-file-probe.ts"], {
        cwd: resolvePath(process.cwd(), "../backend"),
        stdio: ["ignore", "pipe", "pipe"],
      });
      const timer = setTimeout(
        () => reject(new Error("Text-file fixture startup timed out")),
        15000,
      );
      let stderr = "";
      child.stderr?.on("data", (chunk) => {
        stderr += String(chunk);
      });
      child.once("error", reject);
      child.once("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`Text-file fixture exited (${code}): ${stderr}`));
      });
      if (!child.stdout) {
        reject(new Error("Missing fixture stdout"));
        return;
      }
      const lines = createInterface({ input: child.stdout });
      lines.once("line", (line) => {
        clearTimeout(timer);
        try {
          resolve(JSON.parse(line) as Fixture);
        } catch (error) {
          reject(error);
        }
      });
    });
  }, 20000);
  afterAll(async () => {
    if (child && child.exitCode === null) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => child.kill("SIGKILL"), 3000);
        child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
        child.kill("SIGTERM");
      });
    }
  });

  it("renders only the saved reference, previews/expands Markdown, and rereads changed/deleted files on refresh and remount", async () => {
    const saved = Array.from({ length: 20 }, (_, i) => `## Saved step ${i + 1}`).join("\n");
    await writeFile(fixture.path, saved);
    const reply = "I saved the implementation plan.\n\n[Plan](text-file:plan%20100%25.md)";
    const client = createTextFileClient(fixture.url, fixture.conversationId, fetch);
    let view = render(Markdown, { text: reply, textFiles: client });
    try {
      await screen.findByRole("heading", { name: "Saved step 1" });
      expect(screen.getByRole("heading", { name: "Saved step 20" })).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "Saved step 10" })).not.toBeInTheDocument();
      await fireEvent.click(screen.getByRole("button", { name: "Expand document" }));
      expect(screen.getByRole("heading", { name: "Saved step 10" })).toBeInTheDocument();
      expect(reply).not.toContain(saved);
      await writeFile(fixture.path, "# Updated on disk\n\n**Fresh content**");
      await fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
      await screen.findByRole("heading", { name: "Updated on disk" });
      expect(view.container.querySelector("strong")?.textContent).toBe("Fresh content");
      view.unmount();
      view = render(Markdown, { text: reply, textFiles: client });
      await screen.findByRole("heading", { name: "Updated on disk" });
      await rm(fixture.path);
      await fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("Text file not found");
      await writeFile(fixture.path, "# Recreated plan");
      await fireEvent.click(screen.getByRole("button", { name: "Retry" }));
      await screen.findByRole("heading", { name: "Recreated plan" });
    } finally {
      view.unmount();
      client.dispose();
    }
  });

  it("does not read the same local path for an authoritative remote conversation", async () => {
    const client = createTextFileClient(fixture.url, fixture.remoteConversationId, fetch);
    const view = render(Markdown, {
      text: `[Remote](text-file:${encodeURI(fixture.path)})`,
      textFiles: client,
    });
    try {
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "not available for remote computers",
      );
      expect(screen.queryByRole("heading", { name: "Recreated plan" })).not.toBeInTheDocument();
    } finally {
      view.unmount();
      client.dispose();
    }
  });
});
