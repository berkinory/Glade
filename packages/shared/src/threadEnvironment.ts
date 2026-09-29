import type { ThreadEnvironmentMode } from "@glade/contracts";
import { isWorkspaceRootWithin } from "./threadWorkspace";

export type ResolvedThreadWorkspaceState = "local" | "worktree-pending" | "worktree-ready";

export function resolveThreadEnvironmentMode(input: {
  envMode?: ThreadEnvironmentMode | null | undefined;
  worktreePath?: string | null | undefined;
}): ThreadEnvironmentMode {
  if (input.worktreePath) {
    return "worktree";
  }
  return input.envMode ?? "local";
}

export function resolveThreadWorkspaceState(input: {
  envMode?: ThreadEnvironmentMode | null | undefined;
  worktreePath?: string | null | undefined;
}): ResolvedThreadWorkspaceState {
  const mode = resolveThreadEnvironmentMode(input);
  if (mode === "local") {
    return "local";
  }
  return input.worktreePath ? "worktree-ready" : "worktree-pending";
}

export function isPendingThreadWorktree(input: {
  envMode?: ThreadEnvironmentMode | null | undefined;
  worktreePath?: string | null | undefined;
}): boolean {
  return resolveThreadWorkspaceState(input) === "worktree-pending";
}

export function resolveThreadWorkspaceCwd(input: {
  projectCwd?: string | null | undefined;
  envMode?: ThreadEnvironmentMode | null | undefined;
  worktreePath?: string | null | undefined;
  workingDirectory?: string | null | undefined;
}): string | null {
  const mode = resolveThreadEnvironmentMode(input);
  if (mode === "worktree") {
    if (
      input.worktreePath &&
      input.workingDirectory &&
      !input.workingDirectory.replace(/\\/g, "/").split("/").includes("..") &&
      isWorkspaceRootWithin(input.workingDirectory, input.worktreePath)
    ) {
      return input.workingDirectory;
    }
    return input.worktreePath ?? null;
  }
  return input.workingDirectory ?? input.projectCwd ?? null;
}

export function resolveThreadBranchSourceCwd(input: {
  projectCwd?: string | null | undefined;
  worktreePath?: string | null | undefined;
}): string | null {
  return input.worktreePath ?? input.projectCwd ?? null;
}
