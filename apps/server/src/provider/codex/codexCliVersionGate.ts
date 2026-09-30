import type { ChildProcess } from "node:child_process";
import { spawnProcess } from "@glade/shared/processRuntime";
import {
  compareCodexCliVersions,
  formatCodexCliUpgradeMessage,
  isCodexCliVersionSupported,
  parseCodexCliVersion,
} from "../codexCliVersion";
import { buildCodexProcessEnv } from "../../codexProcessEnv.ts";
import { assertCodexWorkingDirectoryExists } from "../../codexWorkingDirectory.ts";
import { executableIdentity, resolveExecutable } from "../../executableLookup.ts";

const CODEX_VERSION_CHECK_TIMEOUT_MS = 4_000;

const CODEX_VERSION_CHECK_MAX_OUTPUT_BYTES = 1024 * 1024;

const CODEX_VERSION_CHECK_CACHE_TTL_MS = 10 * 60 * 1000;

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

interface CodexCliBinaryFingerprint {
  readonly path: string;
  readonly identity: string;
}

async function runCodexCliVersionGate(input: {
  readonly binaryPath: string;
  readonly cwd: string;
  readonly homePath?: string;
  readonly minimumVersion?: string;
  readonly minimumVersionRequirement?: string;
}): Promise<{ fingerprint: CodexCliBinaryFingerprint | null; version: string | null }> {
  const env = await buildCodexProcessEnv(input.homePath ? { homePath: input.homePath } : {});
  // Resolved against the env the spawn below uses, never `process.env`. On macOS and Linux
  // `buildCodexProcessEnv` can replace PATH with the login shell's, so resolving through the process
  // environment could fingerprint a different `codex` than the one being probed — or none at all —
  // and the staleness check would then be watching the wrong file.
  const resolvedPath = resolveExecutable(input.binaryPath, { env });
  const identity = resolvedPath ? executableIdentity(resolvedPath) : null;
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
  const minimumVersion = input.minimumVersion;
  if (minimumVersion && !parsedVersion) {
    throw new Error(
      `Could not determine the installed Codex CLI version. ${input.minimumVersionRequirement ?? "Auto mode"} requires v${minimumVersion} or newer.`,
    );
  }
  if (
    parsedVersion &&
    (minimumVersion
      ? compareCodexCliVersions(parsedVersion, minimumVersion) < 0
      : !isCodexCliVersionSupported(parsedVersion))
  ) {
    throw new Error(formatCodexCliUpgradeMessage(parsedVersion, minimumVersion));
  }

  return {
    fingerprint: resolvedPath && identity ? { path: resolvedPath, identity } : null,
    version: parsedVersion ?? null,
  };
}

interface CodexCliVersionGateEntry {
  promise: Promise<string | null>;

  expiresAt: number;

  fingerprint: CodexCliBinaryFingerprint | null;
}

function codexCliVersionGateKey(
  binaryPath: string,
  homePath: string | undefined,
  minimumVersion: string | undefined,
): string {
  return JSON.stringify([binaryPath, homePath ?? "", minimumVersion ?? ""]);
}

function isCodexCliVersionGateStale(entry: CodexCliVersionGateEntry): boolean {
  if (!entry.fingerprint) {
    // Nothing was located at probe time, so there is nothing to compare against. The probe is what
    // reports that failure, and failures are never cached, so no stale pass can hide here.
    return false;
  }
  return executableIdentity(entry.fingerprint.path) !== entry.fingerprint.identity;
}

export function createCodexCliVersionGate() {
  const codexCliVersionGates = new Map<string, CodexCliVersionGateEntry>();

  return async function assertSupportedCodexCliVersion(input: {
    readonly binaryPath: string;
    readonly cwd: string;
    readonly homePath?: string;
    readonly minimumVersion?: string;
    readonly minimumVersionRequirement?: string;
  }): Promise<string | null> {
    // Prefer an explicit cwd check before spawning. A missing working directory produces ENOENT that is
    // otherwise misreported as a missing Codex binary. This is per-call state, so it must run even when
    // the version verdict is cached.
    assertCodexWorkingDirectoryExists(input.cwd);

    const key = codexCliVersionGateKey(input.binaryPath, input.homePath, input.minimumVersion);
    const now = Date.now();
    const existing = codexCliVersionGates.get(key);
    if (existing) {
      if (existing.expiresAt === 0) {
        return existing.promise;
      }
      if (existing.expiresAt > now && !isCodexCliVersionGateStale(existing)) {
        return existing.promise;
      }
      codexCliVersionGates.delete(key);
    }

    for (const [otherKey, entry] of codexCliVersionGates) {
      if (entry.expiresAt !== 0 && entry.expiresAt <= now) {
        codexCliVersionGates.delete(otherKey);
      }
    }

    const entry: CodexCliVersionGateEntry = {
      promise: Promise.resolve(null),
      expiresAt: 0,
      fingerprint: null,
    };
    entry.promise = runCodexCliVersionGate(input).then(
      ({ fingerprint, version }) => {
        entry.fingerprint = fingerprint;
        entry.expiresAt = Date.now() + CODEX_VERSION_CHECK_CACHE_TTL_MS;
        return version;
      },
      (error: unknown) => {
        if (codexCliVersionGates.get(key) === entry) {
          codexCliVersionGates.delete(key);
        }
        throw error;
      },
    );
    codexCliVersionGates.set(key, entry);
    return entry.promise;
  };
}
