import { Effect, ServiceMap } from "effect";
import type { GitCommandError } from "../Errors.ts";
import type { ExecuteGitInput, ExecuteGitResult, GitCoreShape } from "./GitCore.ts";

// Writes scale with repository size, network speed and hooks. Bound the retained output, not the
// operation; caller interruption still closes the owned process scope.
export const GIT_WRITE_EXECUTION = { timeoutMs: null, outputMode: "truncate" } as const;

// Background network work must fail instead of opening credential prompts nobody asked for.
// User-started pushes and pulls omit this so a credential manager can still ask to sign in.
export const NON_INTERACTIVE_GIT_ENV = {
  GIT_TERMINAL_PROMPT: "0",
  GCM_INTERACTIVE: "never",
  GIT_ASKPASS: "",
  SSH_ASKPASS: "",
  SSH_ASKPASS_REQUIRE: "never",
} as const;

// Network commands wait on remotes for seconds, so they queue apart from local reads.
export type GitProcessLane = "local" | "network";

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
    lane?: GitProcessLane,
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
