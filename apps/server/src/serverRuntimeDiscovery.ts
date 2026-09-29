import { execFileSync } from "node:child_process";

import { randomBytes } from "node:crypto";

import fs from "node:fs";

import os from "node:os";

import path from "node:path";

import type { PersistedServerRuntimeState } from "./serverRuntimeState.ts";

import {
  computeServerRuntimeProof,
  SERVER_RUNTIME_CHALLENGE_HEADER,
  runtimeProofsMatch,
} from "./serverRuntimeProof.ts";

const RUNTIME_CHALLENGE_TIMEOUT_MS = 2_000;

const RUNTIME_STATE_RELATIVE_PATHS = [
  path.join("userdata", "server-runtime.json"),
  path.join("dev", "server-runtime.json"),
] as const;

const WINDOWS_TRUSTED_RUNTIME_ACL_SIDS = new Set([
  "S-1-5-18", // LocalSystem
  "S-1-5-32-544", // Builtin Administrators
]);

const WINDOWS_RUNTIME_ACL_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "$target = $env:GLADE_RUNTIME_ACL_TARGET",
  "$item = Get-Item -LiteralPath $target -Force",
  "$acl = Get-Acl -LiteralPath $target",
  "$currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value",
  "$ownerAccount = New-Object System.Security.Principal.NTAccount($acl.Owner)",
  "$ownerSid = $ownerAccount.Translate([System.Security.Principal.SecurityIdentifier]).Value",
  "$sddl = $acl.GetSecurityDescriptorSddlForm([System.Security.AccessControl.AccessControlSections]::All)",
  "$rawDescriptor = New-Object System.Security.AccessControl.RawSecurityDescriptor($sddl)",
  "$hasDacl = $null -ne $rawDescriptor.DiscretionaryAcl",
  "$rules = @($acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]) | ForEach-Object { [pscustomobject]@{ sid = $_.IdentityReference.Value; type = $_.AccessControlType.ToString() } })",
  "[pscustomobject]@{ currentSid = $currentSid; ownerSid = $ownerSid; hasDacl = $hasDacl; isReparsePoint = [bool]($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint); rules = $rules } | ConvertTo-Json -Compress -Depth 4",
].join("; ");

const WINDOWS_RUNTIME_ACL_ENCODED_COMMAND = Buffer.from(
  WINDOWS_RUNTIME_ACL_SCRIPT,
  "utf16le",
).toString("base64");

function makeWindowsRuntimeAclPowerShellInvocation(targetPath: string) {
  return {
    args: ["-NoProfile", "-NonInteractive", "-EncodedCommand", WINDOWS_RUNTIME_ACL_ENCODED_COMMAND],
    options: {
      encoding: "utf8" as const,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
      timeout: 5_000,
      env: { ...process.env, GLADE_RUNTIME_ACL_TARGET: targetPath },
    },
  };
}

interface WindowsRuntimeAclSnapshot {
  readonly currentSid: string;
  readonly ownerSid: string;
  readonly hasDacl: boolean;
  readonly isReparsePoint: boolean;
  readonly rules: ReadonlyArray<{
    readonly sid: string;
    readonly type: string;
  }>;
}

function isOwnerPrivateWindowsRuntimeAcl(snapshot: WindowsRuntimeAclSnapshot): boolean {
  if (!snapshot.hasDacl || snapshot.isReparsePoint || snapshot.ownerSid !== snapshot.currentSid) {
    return false;
  }
  return snapshot.rules.every(
    (rule) =>
      rule.type !== "Allow" ||
      rule.sid === snapshot.currentSid ||
      WINDOWS_TRUSTED_RUNTIME_ACL_SIDS.has(rule.sid),
  );
}

class ServerRuntimeDiscoveryError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ServerRuntimeDiscoveryError";
  }
}

class ServerRuntimeRequestCancelledError extends Error {
  constructor() {
    super("Server discovery request cancelled.");
    this.name = "ServerRuntimeRequestCancelledError";
  }
}

class ServerRuntimeRequestTimeoutError extends ServerRuntimeDiscoveryError {
  constructor(timeoutMs: number) {
    super(`Glade did not respond within ${timeoutMs} ms.`);
    this.name = "ServerRuntimeRequestTimeoutError";
  }
}

export type ServerRuntimeFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export function resolveServerHome(homeDir?: string): string {
  const configured = homeDir?.trim() || process.env.GLADE_HOME?.trim();
  if (!configured) return path.join(os.homedir(), ".glade");
  if (configured === "~") return os.homedir();
  if (configured.startsWith(`~${path.sep}`) || configured.startsWith("~/")) {
    return path.resolve(os.homedir(), configured.slice(2));
  }
  return path.resolve(configured);
}

function parseRuntimeState(
  raw: string,
  sourcePath: string,
  options: { readonly requireLoopback: boolean },
): PersistedServerRuntimeState {
  try {
    const state = JSON.parse(raw) as Partial<PersistedServerRuntimeState>;
    if (
      state.version !== 1 ||
      !Number.isInteger(state.pid) ||
      !Number.isInteger(state.port) ||
      typeof state.origin !== "string" ||
      typeof state.startedAt !== "string" ||
      typeof state.serverRuntimeSecret !== "string" ||
      state.serverRuntimeSecret.length < 32
    ) {
      throw new Error("invalid runtime-state shape");
    }
    const origin = new URL(state.origin);
    if (origin.protocol !== "http:") {
      throw new Error("runtime origin is not HTTP");
    }
    if (
      options.requireLoopback &&
      !["127.0.0.1", "localhost", "[::1]", "::1"].includes(origin.hostname)
    ) {
      throw new Error("runtime origin is not loopback HTTP");
    }
    return state as PersistedServerRuntimeState;
  } catch (cause) {
    throw new ServerRuntimeDiscoveryError(`Invalid Glade runtime-state file: ${sourcePath}`, {
      cause,
    });
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    return (cause as NodeJS.ErrnoException).code === "EPERM";
  }
}

function assertPrivateRuntimeStat(
  stat: fs.Stats,
  targetPath: string,
  kind: "file" | "directory",
): void {
  const expectedType = kind === "file" ? stat.isFile() : stat.isDirectory();
  if (!expectedType || stat.isSymbolicLink()) {
    throw new ServerRuntimeDiscoveryError(`Refusing unsafe runtime-state ${kind}: ${targetPath}`);
  }
  if (process.platform === "win32") return;
  const currentUid = typeof process.getuid === "function" ? process.getuid() : undefined;
  if (currentUid !== undefined && stat.uid !== currentUid) {
    throw new ServerRuntimeDiscoveryError(
      `Runtime-state ${kind} ${targetPath} is not owned by the current user.`,
    );
  }
  if ((stat.mode & 0o077) !== 0) {
    throw new ServerRuntimeDiscoveryError(
      `Runtime-state ${kind} ${targetPath} is accessible by other users.`,
    );
  }
}

function sameFile(left: fs.Stats, right: fs.Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function assertPrivateWindowsRuntimePath(targetPath: string, kind: "file" | "directory"): void {
  let snapshot: WindowsRuntimeAclSnapshot;
  try {
    const invocation = makeWindowsRuntimeAclPowerShellInvocation(targetPath);
    const raw = execFileSync("powershell.exe", invocation.args, invocation.options);
    const parsed = JSON.parse(raw) as Partial<WindowsRuntimeAclSnapshot>;
    if (
      typeof parsed.currentSid !== "string" ||
      typeof parsed.ownerSid !== "string" ||
      typeof parsed.hasDacl !== "boolean" ||
      typeof parsed.isReparsePoint !== "boolean" ||
      !Array.isArray(parsed.rules) ||
      parsed.rules.some(
        (rule) =>
          typeof rule !== "object" ||
          rule === null ||
          typeof rule.sid !== "string" ||
          typeof rule.type !== "string",
      )
    ) {
      throw new Error("invalid Windows ACL response");
    }
    snapshot = parsed as WindowsRuntimeAclSnapshot;
  } catch (cause) {
    throw new ServerRuntimeDiscoveryError(
      `Could not verify private Windows runtime-state ${kind}: ${targetPath}`,
      { cause },
    );
  }
  if (!isOwnerPrivateWindowsRuntimeAcl(snapshot)) {
    throw new ServerRuntimeDiscoveryError(
      `Runtime-state ${kind} ${targetPath} is not owned by the current user, is accessible by other users, or is a reparse point.`,
    );
  }
}

function readPrivateRuntimeState(sourcePath: string): string {
  const directoryPath = path.dirname(sourcePath);
  const directoryStat = fs.lstatSync(directoryPath);
  assertPrivateRuntimeStat(directoryStat, directoryPath, "directory");
  if (process.platform === "win32") {
    assertPrivateWindowsRuntimePath(directoryPath, "directory");
  }

  const pathStat = fs.lstatSync(sourcePath);
  assertPrivateRuntimeStat(pathStat, sourcePath, "file");
  if (process.platform === "win32") {
    assertPrivateWindowsRuntimePath(sourcePath, "file");
  }
  const flags =
    process.platform === "win32"
      ? fs.constants.O_RDONLY
      : fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW;
  const descriptor = fs.openSync(sourcePath, flags);
  try {
    const descriptorStat = fs.fstatSync(descriptor);
    assertPrivateRuntimeStat(descriptorStat, sourcePath, "file");
    if (!sameFile(pathStat, descriptorStat)) {
      throw new ServerRuntimeDiscoveryError(
        `Runtime-state file changed while it was being validated: ${sourcePath}`,
      );
    }
    const raw = fs.readFileSync(descriptor, "utf8");
    const directoryAfterRead = fs.lstatSync(directoryPath);
    assertPrivateRuntimeStat(directoryAfterRead, directoryPath, "directory");
    if (!sameFile(directoryStat, directoryAfterRead)) {
      throw new ServerRuntimeDiscoveryError(
        `Runtime-state directory changed while it was being validated: ${directoryPath}`,
      );
    }
    return raw;
  } finally {
    fs.closeSync(descriptor);
  }
}

function discoverRunningRuntime(
  baseDir: string,
  options: { readonly requireLoopback: boolean },
): {
  readonly state: PersistedServerRuntimeState;
  readonly sourcePath: string;
} {
  const candidates = RUNTIME_STATE_RELATIVE_PATHS.flatMap((relativePath) => {
    const sourcePath = path.join(baseDir, relativePath);
    if (!fs.existsSync(sourcePath)) return [];
    const state = parseRuntimeState(readPrivateRuntimeState(sourcePath), sourcePath, options);
    return processIsAlive(state.pid) ? [{ state, sourcePath }] : [];
  });
  if (candidates.length === 0) {
    throw new ServerRuntimeDiscoveryError(
      `No running Glade instance was found under ${baseDir}. Start Glade first or pass --home-dir for the intended instance.`,
    );
  }
  if (candidates.length > 1) {
    throw new ServerRuntimeDiscoveryError(
      `Multiple running Glade instances were found under ${baseDir}: ${candidates.map((candidate) => candidate.state.origin).join(", ")}. Stop one instance or pass a distinct --home-dir.`,
    );
  }
  return candidates[0]!;
}

export function discoverServerRuntime(baseDir: string): {
  readonly state: PersistedServerRuntimeState;
  readonly sourcePath: string;
} {
  return discoverRunningRuntime(baseDir, { requireLoopback: false });
}

async function fetchServerRuntimeWithTimeout(
  fetchImpl: ServerRuntimeFetch,
  url: URL,
  init: RequestInit,
  timeoutMs: number,
  cancellationSignal?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController();
  if (cancellationSignal?.aborted) throw new ServerRuntimeRequestCancelledError();
  let rejectCancellation: ((cause: ServerRuntimeRequestCancelledError) => void) | null = null;
  const cancellation = new Promise<never>((_resolve, reject) => {
    rejectCancellation = reject;
  });
  const cancel = () => {
    controller.abort();
    rejectCancellation?.(new ServerRuntimeRequestCancelledError());
  };
  cancellationSignal?.addEventListener("abort", cancel, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new ServerRuntimeRequestTimeoutError(timeoutMs));
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      fetchImpl(url, { ...init, signal: controller.signal }),
      timeout,
      cancellation,
    ]);
  } catch (cause) {
    if (cancellationSignal?.aborted) throw new ServerRuntimeRequestCancelledError();
    throw cause;
  } finally {
    if (timer) clearTimeout(timer);
    cancellationSignal?.removeEventListener("abort", cancel);
  }
}

async function readServerRuntimeResponseText(
  response: Response,
  timeoutMs = RUNTIME_CHALLENGE_TIMEOUT_MS,
): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const readAll = async () => {
    let result = "";
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) return result + decoder.decode();
      result += decoder.decode(chunk.value, { stream: true });
    }
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      void reader.cancel().catch(() => undefined);
      reject(new ServerRuntimeDiscoveryError(`Glade response body stalled for ${timeoutMs} ms.`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([readAll(), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
    reader.releaseLock();
  }
}

async function verifyPersistedServerRuntime(
  runtime: ReturnType<typeof discoverServerRuntime>,
  fetchImpl: ServerRuntimeFetch,
): Promise<void> {
  const nonce = randomBytes(24).toString("base64url");
  const response = await fetchServerRuntimeWithTimeout(
    fetchImpl,
    new URL("/api/server/runtime-challenge", runtime.state.origin),
    {
      method: "POST",
      headers: {
        [SERVER_RUNTIME_CHALLENGE_HEADER]: nonce,
        Accept: "application/json",
      },
    },
    RUNTIME_CHALLENGE_TIMEOUT_MS,
  );
  let body: { readonly proof?: unknown } | null;
  try {
    body = JSON.parse(await readServerRuntimeResponseText(response)) as {
      readonly proof?: unknown;
    };
  } catch {
    body = null;
  }
  const expected = computeServerRuntimeProof(runtime.state.serverRuntimeSecret, nonce);
  if (
    !response.ok ||
    typeof body?.proof !== "string" ||
    !runtimeProofsMatch(expected, body.proof)
  ) {
    throw new ServerRuntimeDiscoveryError(
      "The server endpoint did not prove it is the Glade process named by the private runtime-state file.",
    );
  }
}

export async function verifyServerRuntime(
  runtime: ReturnType<typeof discoverServerRuntime>,
  fetchImpl: ServerRuntimeFetch,
): Promise<void> {
  await verifyPersistedServerRuntime(runtime, fetchImpl);
}
