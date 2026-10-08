import * as Path from "node:path";

import { resolveExecutable } from "./executable";
import { resolveWindowsComSpec, resolveWindowsWslExecutable } from "./platformEnvironment";

export interface WindowsSafeProcessInput {
  readonly platform?: NodeJS.Platform | undefined;
  readonly cwd?: string | undefined;
  readonly env?: NodeJS.ProcessEnv | undefined;
}

export interface WindowsSafeProcessCommand {
  readonly command: string;
  readonly args: string[];
  readonly shell: false;
  readonly windowsHide?: true;
  readonly windowsVerbatimArguments?: true;
}

export interface WindowsWslUncPath {
  readonly distribution: string;
  readonly linuxPath: string;
}

const WINDOWS_BATCH_EXTENSION_PATTERN = /\.(?:cmd|bat)$/i;
const WINDOWS_PATH_SEPARATOR_PATTERN = /[\\/]/;
const WINDOWS_BATCH_UNSAFE_TOKEN_PATTERN = /[\r\n&|<>^%]/;
const WINDOWS_WSL_UNC_PATTERN = /^\\\\(?:wsl\.localhost|wsl\$)\\([^\\]+)(?:\\(.*))?$/i;

export function parseWindowsWslUncPath(value: string): WindowsWslUncPath | null {
  const match = WINDOWS_WSL_UNC_PATTERN.exec(value.trim());
  if (!match) {
    return null;
  }

  const distribution = match[1]?.trim() ?? "";
  if (!distribution) {
    return null;
  }

  const suffix = match[2] ?? "";
  const linuxPath = `/${suffix
    .split("\\")
    .filter((segment) => segment.length > 0)
    .join("/")}`;
  return {
    distribution,
    linuxPath: linuxPath === "/" ? "/" : linuxPath,
  };
}

function isWindowsBatchCommand(command: string): boolean {
  return WINDOWS_BATCH_EXTENSION_PATTERN.test(command);
}

function quoteWindowsBatchToken(token: string, label: string): string {
  if (WINDOWS_BATCH_UNSAFE_TOKEN_PATTERN.test(token)) {
    throw new Error(
      `Cannot safely execute Windows batch ${label} containing cmd.exe control characters.`,
    );
  }
  return `"${token.replaceAll('"', '""')}"`;
}

function buildWindowsBatchCommandArgs(command: string, args: ReadonlyArray<string>): string[] {
  const commandLine = [
    "call",
    quoteWindowsBatchToken(command, "command"),
    ...args.map((arg) => quoteWindowsBatchToken(arg, "argument")),
  ].join(" ");
  return ["/d", "/s", "/v:off", "/c", commandLine];
}

function isPathLikeCommand(command: string): boolean {
  return WINDOWS_PATH_SEPARATOR_PATTERN.test(command) || Path.win32.isAbsolute(command);
}

function hasWindowsExecutableExtension(command: string): boolean {
  return Path.win32.extname(command).length > 0;
}

function resolveWindowsCommandPath(command: string, input: WindowsSafeProcessInput = {}): string {
  const pathLikeCommand = isPathLikeCommand(command);
  if (pathLikeCommand && hasWindowsExecutableExtension(command)) {
    return command;
  }

  const env = input.env ?? process.env;
  return resolveExecutable(command, { platform: "win32", env }) ?? command;
}

export function prepareWindowsSafeProcess(
  command: string,
  args: ReadonlyArray<string>,
  input: WindowsSafeProcessInput = {},
): WindowsSafeProcessCommand {
  const platform = input.platform ?? process.platform;
  if (platform !== "win32") {
    return { command, args: [...args], shell: false };
  }

  const env = input.env ?? process.env;
  const wslWorkspace = input.cwd ? parseWindowsWslUncPath(input.cwd) : null;
  if (wslWorkspace) {
    return {
      command: resolveWindowsWslExecutable(env),
      args: [
        "--distribution",
        wslWorkspace.distribution,
        "--cd",
        wslWorkspace.linuxPath,
        "--exec",
        command,
        ...args,
      ],
      shell: false,
      windowsHide: true,
    };
  }

  const resolvedCommand = resolveWindowsCommandPath(command, input);
  if (!isWindowsBatchCommand(resolvedCommand)) {
    return {
      command: resolvedCommand,
      args: [...args],
      shell: false,
      windowsHide: true,
    };
  }

  return {
    command: resolveWindowsComSpec(env),
    args: buildWindowsBatchCommandArgs(resolvedCommand, args),
    shell: false,
    windowsHide: true,
    windowsVerbatimArguments: true,
  };
}
