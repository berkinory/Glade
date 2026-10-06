import type { ChildProcess } from "node:child_process";
import { spawnProcess } from "@glade/shared/platform/processRuntime";
import {
  formatCodexCliUpgradeMessage,
  isCodexCliVersionSupported,
  parseCodexCliVersion,
} from "./codexCliVersion";
import { buildCodexProcessEnv } from "./codexProcessEnv.ts";
import { CODEX_PROTOCOL_VERSION } from "./protocol/version.ts";
import { assertCodexWorkingDirectoryExists } from "./codexWorkingDirectory.ts";
import { resolveExecutable } from "@glade/shared/platform/executable";
import {
  cliBinaryFingerprint,
  makeCliVersionGate,
  type CliVersionProbeResult,
} from "../core/cliVersionGate.ts";

const CODEX_VERSION_CHECK_TIMEOUT_MS = 4_000;

const CODEX_VERSION_CHECK_MAX_OUTPUT_BYTES = 1024 * 1024;

function isMissingExecutableSpawnError(error: Error): boolean {
  const lower = error.message.toLowerCase();
  return (
    lower.includes("enoent") ||
    lower.includes("command not found") ||
    lower.includes("not found") ||
    lower.includes("filesystem.access")
  );
}

interface CodexVersionCommandResult {
  readonly error?: Error;
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function runCodexVersionCommand(input: {
  readonly binaryPath: string;
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
}): Promise<CodexVersionCommandResult> {
  return new Promise<CodexVersionCommandResult>((resolve) => {
    let child: ChildProcess;
    try {
      child = spawnProcess(input.binaryPath, ["--version"], {
        requireExecutable: true,
        cwd: input.cwd,
        env: input.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      resolve({
        error: error instanceof Error ? error : new Error(String(error)),
        status: null,
        stdout: "",
        stderr: "",
      });
      return;
    }

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (result: CodexVersionCommandResult) => {
      if (settled) return;
      settled = true;
      if (timer) {
        clearTimeout(timer);
      }
      resolve(result);
    };

    const append = (buffer: string, chunk: string) =>
      buffer.length >= CODEX_VERSION_CHECK_MAX_OUTPUT_BYTES
        ? buffer
        : (buffer + chunk).slice(0, CODEX_VERSION_CHECK_MAX_OUTPUT_BYTES);

    timer = setTimeout(() => {
      // SIGKILL (rather than spawnSync's SIGTERM) because the promise settles here regardless: a binary
      // that ignores SIGTERM would otherwise linger forever.
      child.kill("SIGKILL");
      finish({
        error: new Error(
          `Codex CLI version check timed out after ${CODEX_VERSION_CHECK_TIMEOUT_MS}ms.`,
        ),
        status: null,
        stdout,
        stderr,
      });
    }, CODEX_VERSION_CHECK_TIMEOUT_MS);
    timer.unref?.();

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout = append(stdout, chunk);
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr = append(stderr, chunk);
    });
    child.on("error", (error) => {
      finish({ error, status: null, stdout, stderr });
    });
    child.on("close", (code, signal) => {
      finish({ status: code ?? (signal ? -1 : 0), stdout, stderr });
    });
  });
}

async function runCodexCliVersionGate(input: {
  readonly binaryPath: string;
  readonly cwd: string;
  readonly homePath?: string;
}): Promise<CliVersionProbeResult> {
  const env = await buildCodexProcessEnv(input.homePath ? { homePath: input.homePath } : {});
  // Resolved against the env the spawn below uses, never `process.env`, so the staleness check
  // fingerprints the same `codex` that is probed.
  const fingerprint = cliBinaryFingerprint(resolveExecutable(input.binaryPath, { env }));
  const result = await runCodexVersionCommand({
    binaryPath: input.binaryPath,
    cwd: input.cwd,
    env,
  });

  if (result.error) {
    if (isMissingExecutableSpawnError(result.error)) {
      // Race: cwd may have disappeared between the pre-check and spawn.
      assertCodexWorkingDirectoryExists(input.cwd);
      throw new Error(`Codex CLI (${input.binaryPath}) is not installed or not executable.`);
    }
    throw new Error(
      `Failed to execute Codex CLI version check: ${result.error.message || String(result.error)}`,
    );
  }

  const { stdout, stderr } = result;
  if (result.status !== 0) {
    const detail = stderr.trim() || stdout.trim() || `Command exited with code ${result.status}.`;
    throw new Error(`Codex CLI version check failed. ${detail}`);
  }

  const parsedVersion = parseCodexCliVersion(`${stdout}\n${stderr}`);
  if (!parsedVersion) {
    throw new Error(
      `Could not determine the installed Codex CLI version. Glade requires v${CODEX_PROTOCOL_VERSION} or newer.`,
    );
  }
  if (!isCodexCliVersionSupported(parsedVersion)) {
    throw new Error(formatCodexCliUpgradeMessage(parsedVersion));
  }

  return { fingerprint, version: parsedVersion };
}

export function createCodexCliVersionGate() {
  const gate = makeCliVersionGate({
    isSupported: (version) => version !== null && isCodexCliVersionSupported(version),
  });

  return async function assertSupportedCodexCliVersion(input: {
    readonly binaryPath: string;
    readonly cwd: string;
    readonly homePath?: string;
  }): Promise<string | null> {
    // Prefer an explicit cwd check before spawning. A missing working directory produces ENOENT that is
    // otherwise misreported as a missing Codex binary. This is per-call state, so it must run even when
    // the version verdict is cached.
    assertCodexWorkingDirectoryExists(input.cwd);
    return gate.check(
      JSON.stringify([input.binaryPath, input.homePath ?? "", process.env.PATH ?? ""]),
      () => runCodexCliVersionGate(input),
    );
  };
}
