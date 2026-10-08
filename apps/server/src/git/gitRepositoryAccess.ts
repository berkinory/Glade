import { Effect, Schema } from "effect";
import {
  GIT_NOT_FOUND_ERROR_CODE,
  GIT_UNSAFE_REPOSITORY_ERROR_CODE,
} from "@glade/contracts/git/git";
import { GitCommandError } from "./Errors";
import type { GitCoreShape } from "./Services/GitCore";

export const GIT_NOT_FOUND_DETAIL = "Git was not found. Install Git or add it to PATH, then retry.";

const DUBIOUS_OWNERSHIP = /detected dubious ownership/i;
const SAFE_DIRECTORY_HINT = /git config --global --add safe\.directory (.+)$/m;

// Git prints the path shell-quoted ('it'\''s') when it needs quoting and bare otherwise.
function unquoteShellSingle(value: string): string {
  if (!value.startsWith("'") || !value.endsWith("'") || value.length < 2) return value;
  return value.slice(1, -1).replaceAll("'\\''", "'").replaceAll("'\\!'", "!");
}

function safeDirectoryFromGitError(stderr: string): string | null {
  if (!DUBIOUS_OWNERSHIP.test(stderr)) return null;
  const hint = SAFE_DIRECTORY_HINT.exec(stderr)?.[1]?.trim();
  return hint ? unquoteShellSingle(hint) : null;
}

// Git's own trimmed reason, with a code where the client offers a specific recovery.
export function gitFailureReason(cause: unknown) {
  if (!Schema.is(GitCommandError)(cause)) return null;
  const message = cause.detail.trim();
  if (cause.detail === GIT_NOT_FOUND_DETAIL) return { code: GIT_NOT_FOUND_ERROR_CODE, message };
  if (DUBIOUS_OWNERSHIP.test(message)) return { code: GIT_UNSAFE_REPOSITORY_ERROR_CODE, message };
  return { message };
}

// Writes the global Git config, so it runs only from an explicit user action. The path is the one
// Git itself names for this folder, never one supplied by the client.
export function trustRepository(git: GitCoreShape, cwd: string) {
  return Effect.gen(function* () {
    const probe = yield* git.execute({
      cwd,
      operation: "trust repository",
      args: ["rev-parse", "--git-dir"],
      allowNonZeroExit: true,
    });
    if (probe.code === 0) return;
    const directory = safeDirectoryFromGitError(probe.stderr);
    if (!directory)
      return yield* new GitCommandError({
        cwd,
        operation: "trust repository",
        command: "git rev-parse",
        detail: probe.stderr.trim() || "Git did not report an ownership problem for this folder.",
      });
    yield* git.execute({
      cwd,
      operation: "trust repository",
      args: ["config", "--global", "--add", "safe.directory", directory],
    });
  });
}
