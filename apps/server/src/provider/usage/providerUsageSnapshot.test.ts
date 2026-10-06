import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { loadLocalProviderUsageLines } from "./providerUsageSnapshot";

const transcriptLine = (requestId: string, outputTokens: number) =>
  `${JSON.stringify({
    type: "assistant",
    sessionId: "session-1",
    requestId,
    timestamp: new Date().toISOString(),
    message: { model: "claude", usage: { output_tokens: outputTokens } },
  })}\n`;

describe("Claude usage snapshot", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("unchanged transcripts are not reparsed and growing transcripts count new samples", async () => {
    const homeDir = mkdtempSync(path.join(os.tmpdir(), "glade-claude-usage-"));
    vi.stubEnv("CLAUDE_CONFIG_DIR", "");
    vi.useFakeTimers({ toFake: ["Date"] });
    const projectDir = path.join(homeDir, ".claude", "projects", "project");
    mkdirSync(projectDir, { recursive: true });
    const transcript = path.join(projectDir, "session-1.jsonl");
    const pinnedMtime = new Date(Math.floor(Date.now() / 1000) * 1000);
    const writeTranscript = (contents: string) => {
      writeFileSync(transcript, contents);
      utimesSync(transcript, pinnedMtime, pinnedMtime);
    };
    const tokens24h = async () => {
      // Step past the 30s snapshot cache so each read recomputes the totals.
      vi.setSystemTime(Date.now() + 31_000);
      const lines = await loadLocalProviderUsageLines({ provider: "claudeAgent", homeDir });
      return lines.find((line) => line.label === "24h")?.value;
    };

    try {
      writeTranscript(transcriptLine("request-1", 100));
      expect(await tokens24h()).toBe("100 tokens");

      writeTranscript(transcriptLine("request-1", 900));
      expect(await tokens24h()).toBe("100 tokens");

      writeFileSync(transcript, transcriptLine("request-2", 50), { flag: "a" });
      expect(await tokens24h()).toBe("950 tokens");
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });
});
