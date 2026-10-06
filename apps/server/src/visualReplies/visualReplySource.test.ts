import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { prepareVisualReply } from "./visualReplySource";

describe("visual reply workspace boundary", () => {
  it("embeds workspace images but rejects outside paths, symlink escapes and disguised files", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "glade-visual-source-"));
    try {
      const workspace = path.join(root, "workspace");
      await fs.mkdir(workspace);
      await fs.writeFile(path.join(root, "secret.html"), "private host data");
      await fs.symlink(path.join(root, "secret.html"), path.join(workspace, "escape.html"));
      const png = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6JkAAAAASUVORK5CYII=",
        "base64",
      );
      await fs.writeFile(path.join(workspace, "image.png"), png);
      await fs.writeFile(path.join(workspace, "fake.png"), "private host data");
      await fs.writeFile(
        path.join(workspace, "view.html"),
        '<h1>Workspace chart</h1><img src="image.png">',
      );
      const prepared = await Effect.runPromise(
        prepareVisualReply({
          workspaceRoot: workspace,
          source: { title: "Chart", path: "view.html" },
        }),
      );
      expect(prepared.html).toContain(`data:image/png;base64,${png.toString("base64")}`);
      const inline = await Effect.runPromise(
        prepareVisualReply({
          workspaceRoot: null,
          source: { title: "Inline", html: "<h1>Chart</h1>" },
        }),
      );
      expect(inline.html).toContain("<h1>Chart</h1>");
      for (const source of [
        { title: "File", path: "view.html" },
        { title: "Local image", html: '<img src="image.png">' },
      ]) {
        await expect(
          Effect.runPromise(prepareVisualReply({ workspaceRoot: null, source })),
        ).rejects.toThrow("workspace");
      }
      for (const source of [
        { title: "Escape", path: "../secret.html" },
        { title: "Symlink", path: "escape.html" },
        { title: "Disguised", html: '<img src="fake.png">' },
        { title: "Remote", html: '<script src="https://example.test/app.js"></script>' },
        { title: "Invalid input", html: "one", path: "view.html" },
      ]) {
        await expect(
          Effect.runPromise(prepareVisualReply({ workspaceRoot: workspace, source })),
        ).rejects.toThrow();
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
