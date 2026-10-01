import { createCodexCliVersionGate } from "./codexCliVersionGate";
import { describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { formatMissingCodexWorkingDirectoryError } from "./codexWorkingDirectory";
describe("codex CLI version gate", () => {
  it("memoizes the version probe per binary and shares concurrent probes", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "glade-codex-version-"));
    const homePath = path.join(dir, "codex-home");
    mkdirSync(homePath, { recursive: true });
    vi.stubEnv("GLADE_HOME", path.join(dir, "runtime"));

    const isWindows = process.platform === "win32";
    const counterPath = path.join(dir, "calls.log");
    const binaryPath = path.join(dir, isWindows ? "codex.cmd" : "codex.sh");
    writeFileSync(
      binaryPath,
      isWindows
        ? `@echo off\r\necho x>>"${counterPath}"\r\necho codex-cli 9.9.9\r\n`
        : `#!/bin/sh\necho x >> "${counterPath}"\necho "codex-cli 9.9.9"\n`,
      { mode: 0o755 },
    );
    const probeCount = () => {
      try {
        return readFileSync(counterPath, "utf8").split("\n").filter(Boolean).length;
      } catch {
        return 0;
      }
    };

    let assertSupportedCodexCliVersion = createCodexCliVersionGate();
    try {
      await Promise.all([
        assertSupportedCodexCliVersion({ binaryPath, cwd: dir, homePath }),
        assertSupportedCodexCliVersion({ binaryPath, cwd: dir, homePath }),
      ]);
      expect(probeCount()).toBe(1);

      await assertSupportedCodexCliVersion({ binaryPath, cwd: dir, homePath });
      expect(probeCount()).toBe(1);

      await expect(
        assertSupportedCodexCliVersion({
          binaryPath,
          cwd: path.join(dir, "missing"),
          homePath,
        }),
      ).rejects.toThrow(formatMissingCodexWorkingDirectoryError(path.join(dir, "missing")));
      expect(probeCount()).toBe(1);

      assertSupportedCodexCliVersion = createCodexCliVersionGate();
      await assertSupportedCodexCliVersion({ binaryPath, cwd: dir, homePath });
      expect(probeCount()).toBe(2);
    } finally {
      vi.unstubAllEnvs();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails closed when the Codex CLI version cannot be parsed", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "glade-codex-version-auto-unknown-"));
    const homePath = path.join(dir, "codex-home");
    mkdirSync(homePath, { recursive: true });
    vi.stubEnv("GLADE_HOME", path.join(dir, "runtime"));

    const isWindows = process.platform === "win32";
    const binaryPath = path.join(dir, isWindows ? "codex.cmd" : "codex.sh");
    writeFileSync(
      binaryPath,
      isWindows
        ? "@echo off\r\necho codex-cli development\r\n"
        : '#!/bin/sh\necho "codex-cli development"\n',
      { mode: 0o755 },
    );

    const assertSupportedCodexCliVersion = createCodexCliVersionGate();
    try {
      await expect(
        assertSupportedCodexCliVersion({ binaryPath, cwd: dir, homePath }),
      ).rejects.toThrow("Could not determine the installed Codex CLI version");
    } finally {
      vi.unstubAllEnvs();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("re-probes when a PATH-resolved codex is replaced behind the same bare name", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "glade-codex-version-path-"));
    const homePath = path.join(dir, "codex-home");
    mkdirSync(homePath, { recursive: true });
    vi.stubEnv("GLADE_HOME", path.join(dir, "runtime"));

    const isWindows = process.platform === "win32";
    const binaryPath = path.join(dir, isWindows ? "codex.cmd" : "codex");
    const writeBinary = (version: string, filler: string) => {
      writeFileSync(
        binaryPath,
        isWindows
          ? `@echo off\r\nrem ${filler}\r\necho codex-cli ${version}\r\n`
          : `#!/bin/sh\n# ${filler}\necho "codex-cli ${version}"\n`,
        { mode: 0o755 },
      );
    };

    vi.stubEnv("PATH", `${dir}${path.delimiter}${process.env.PATH ?? ""}`);

    let assertSupportedCodexCliVersion = createCodexCliVersionGate();
    try {
      writeBinary("9.9.9", "original");
      await assertSupportedCodexCliVersion({ binaryPath: "codex", cwd: dir, homePath });

      writeBinary("0.1.0", "replaced-in-place-by-a-downgrade");
      await expect(
        assertSupportedCodexCliVersion({ binaryPath: "codex", cwd: dir, homePath }),
      ).rejects.toThrow(/too old for Glade/);
    } finally {
      vi.unstubAllEnvs();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
