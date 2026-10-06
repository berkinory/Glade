import { Effect, ServiceMap } from "effect";
import type { GitCommandError } from "../Errors.ts";
import type { ExecuteGitInput, ExecuteGitResult, GitCoreShape } from "./GitCore.ts";

// Writes scale with repository size, network speed and hooks. Bound the retained output, not the
// operation; caller interruption still closes the owned process scope.
export const GIT_WRITE_EXECUTION = { timeoutMs: null, outputMode: "truncate" } as const;

export interface ExecuteGitOptions {
  priority?: "foreground" | "background" | undefined;
  timeoutMs?: number | null | undefined;
  allowNonZeroExit?: boolean | undefined;
  fallbackErrorMessage?: string | undefined;
  env?: NodeJS.ProcessEnv | undefined;
  progress?: ExecuteGitInput["progress"] | undefined;
  maxOutputBytes?: number | undefined;
  outputMode?: "error" | "truncate" | "prefix" | undefined;
}

export interface GitCommandsShape {
  readonly withPermit: <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    priority?: "foreground" | "background",
  ) => Effect.Effect<A, E, R>;
  readonly execute: GitCoreShape["execute"];
  readonly executeGit: (
    operation: string,
    cwd: string,
    args: readonly string[],
    options?: ExecuteGitOptions,
  ) => Effect.Effect<ExecuteGitResult, GitCommandError>;
  readonly runGit: (
    operation: string,
    cwd: string,
    args: readonly string[],
    allowNonZeroExit?: boolean,
  ) => Effect.Effect<void, GitCommandError>;
  readonly runGitStdout: (
    operation: string,
    cwd: string,
    args: readonly string[],
    allowNonZeroExit?: boolean,
  ) => Effect.Effect<string, GitCommandError>;
}

export class GitCommands extends ServiceMap.Service<GitCommands, GitCommandsShape>()(
  "glade/git/Services/GitCommands",
) {}
