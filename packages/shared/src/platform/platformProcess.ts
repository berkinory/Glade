import { statSync } from "node:fs";
import { win32 } from "node:path";

import { hasPathSeparator, resolveExecutable } from "./executable";
import { resolveWindowsPowerShellExecutable } from "./platformEnvironment";
import {
  parseWindowsWslUncPath,
  prepareWindowsSafeProcess,
  type WindowsSafeProcessCommand,
} from "./windowsProcess";

export type ProcessExecutionBackend = "native" | "wsl";

export interface ProcessLaunchInput {
  readonly platform?: NodeJS.Platform;
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;

  readonly requireExecutable?: boolean;
}

export interface ProcessLaunchPlan extends WindowsSafeProcessCommand {
  readonly requestedCommand: string;
  readonly resolvedCommand: string;
  readonly executionBackend: ProcessExecutionBackend;
}

export class ExecutableNotFoundError extends Error {
  readonly _tag = "ExecutableNotFoundError";
  readonly command: string;

  constructor(command: string) {
    super(`Command not found: ${command}`);
    this.name = "ExecutableNotFoundError";
    this.command = command;
  }
}

const WINDOWS_COMMAND_NOT_FOUND_EXIT_CODE = 9009;
const WINDOWS_COMMAND_NOT_FOUND_PATTERN = /is not recognized as an internal or external command/iu;

export function isCommandNotFoundExit(input: {
  readonly code: number | null;
  readonly stderr: string;
  readonly platform?: NodeJS.Platform;
}): boolean {
  if ((input.platform ?? process.platform) !== "win32") return false;
  if (input.code === WINDOWS_COMMAND_NOT_FOUND_EXIT_CODE) return true;
  return WINDOWS_COMMAND_NOT_FOUND_PATTERN.test(input.stderr);
}

function explicitPowerShellScript(
  command: string,
  platform: NodeJS.Platform,
  cwd: string | undefined,
): string | null {
  if (platform !== "win32" || !hasPathSeparator(command) || !/\.ps1$/iu.test(command)) {
    return null;
  }
  const scriptPath = win32.isAbsolute(command)
    ? command
    : win32.resolve(cwd ?? process.cwd(), command);
  try {
    return statSync(scriptPath).isFile() ? command : null;
  } catch {
    return null;
  }
}

// A Windows PATH walk stats every directory for every PATHEXT spelling, synchronously, before
// each spawn; hot callers like git spawn constantly, so bare-command hits are reused while the
// resolved file still exists.
const resolvedWindowsCommands = new Map<string, string>();

function resolveNativeExecutable(
  command: string,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  cwd: string | undefined,
): string | null {
  const lookup = () =>
    resolveExecutable(command, { platform, env, ...(cwd !== undefined ? { cwd } : {}) });
  if (platform !== "win32" || hasPathSeparator(command)) return lookup();

  const key = [command, env.PATH ?? env.Path ?? env.path, env.PATHEXT].join("\0");
  const cached = resolvedWindowsCommands.get(key);
  if (cached !== undefined && isFile(cached)) return cached;
  const resolved = lookup();
  if (resolved === null) resolvedWindowsCommands.delete(key);
  else resolvedWindowsCommands.set(key, resolved);
  return resolved;
}

function isFile(filePath: string): boolean {
  try {
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function nativeExecutable(
  command: string,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  cwd: string | undefined,
): string | null {
  return (
    explicitPowerShellScript(command, platform, cwd) ??
    resolveNativeExecutable(command, platform, env, cwd)
  );
}

// Application and provider code must not reproduce the Windows `.cmd`, `cmd.exe`, PATHEXT, or WSL
// rules represented here.
export function prepareProcess(
  command: string,
  args: ReadonlyArray<string>,
  input: ProcessLaunchInput = {},
): ProcessLaunchPlan {
  const platform = input.platform ?? process.platform;
  const env = input.env ?? process.env;
  const wslWorkspace = platform === "win32" && input.cwd ? parseWindowsWslUncPath(input.cwd) : null;

  if (wslWorkspace) {
    const prepared = prepareWindowsSafeProcess(command, args, {
      platform,
      cwd: input.cwd,
      env,
    });
    return {
      ...prepared,
      requestedCommand: command,
      resolvedCommand: command,
      executionBackend: "wsl",
    };
  }

  const resolved = nativeExecutable(command, platform, env, input.cwd);
  if (input.requireExecutable && resolved === null) {
    throw new ExecutableNotFoundError(command);
  }
  const resolvedCommand = resolved ?? command;

  if (platform !== "win32") {
    return {
      command: resolvedCommand,
      args: [...args],
      shell: false,
      requestedCommand: command,
      resolvedCommand,
      executionBackend: "native",
    };
  }

  if (/\.ps1$/iu.test(resolvedCommand)) {
    return {
      command: resolveWindowsPowerShellExecutable(env),
      args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", resolvedCommand, ...args],
      shell: false,
      windowsHide: true,
      requestedCommand: command,
      resolvedCommand,
      executionBackend: "native",
    };
  }

  const prepared = prepareWindowsSafeProcess(resolvedCommand, args, {
    platform,
    cwd: input.cwd,
    env,
  });
  return {
    ...prepared,
    requestedCommand: command,
    resolvedCommand,
    executionBackend: "native",
  };
}
