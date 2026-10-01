import type { ProjectScript } from "@glade/contracts/orchestration/threadEntities";

import { runShellCommand } from "../platform/processRunner.ts";

const WORKTREE_SETUP_TIMEOUT_MS = 10 * 60_000;

function findWorktreeSetupScript(scripts: ReadonlyArray<ProjectScript>): ProjectScript | null {
  return scripts.find((script) => script.runOnWorktreeCreate) ?? null;
}

export async function runWorktreeSetupScript(
  scripts: ReadonlyArray<ProjectScript>,
  cwd: string,
  signal?: AbortSignal,
): Promise<void> {
  const script = findWorktreeSetupScript(scripts);
  if (!script) return;

  await runShellCommand(script.command, {
    cwd,
    timeoutMs: WORKTREE_SETUP_TIMEOUT_MS,
    maxBufferBytes: 8 * 1024 * 1024,
    ...(signal ? { signal } : {}),
  });
}
