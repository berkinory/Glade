import { strict as assert } from "node:assert";

import { loadClaudeAgentSdk } from "../provider/claude/claudeAgentSdk.ts";

await loadClaudeAgentSdk();
await import("open");
await import("node-pty");
await import("@xterm/headless");

const parsePatchFiles = await import("@pierre/diffs").then((module) => module.parsePatchFiles);
const patches = parsePatchFiles(
  "diff --git a/smoke.txt b/smoke.txt\n--- a/smoke.txt\n+++ b/smoke.txt\n@@ -1 +1 @@\n-before\n+after\n",
);
assert.equal(patches[0]?.files[0]?.name, "smoke.txt");
console.log("Packaged runtime dependency smoke passed.");
