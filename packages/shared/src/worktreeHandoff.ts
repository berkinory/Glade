export interface WorktreeHandoffWorkspaceMetadata {
  readonly envMode: "local" | "worktree";
  readonly branch: string | null;
  readonly worktreePath: string | null;
  readonly associatedWorktreePath: string | null;
  readonly associatedWorktreeBranch: string | null;
  readonly associatedWorktreeRef: string | null;
  readonly createBranchFlowCompleted?: false;
}

export function resolveWorktreeHandoffWorkspaceMetadata(input: {
  readonly targetMode: "local" | "worktree";
  readonly branch: string | null;
  readonly worktreePath: string | null;
  readonly associatedWorktreePath: string | null;
  readonly associatedWorktreeBranch: string | null;
  readonly associatedWorktreeRef: string | null;
}): WorktreeHandoffWorkspaceMetadata {
  return {
    envMode: input.targetMode,
    branch: input.branch,
    worktreePath: input.worktreePath,
    associatedWorktreePath: input.associatedWorktreePath,
    associatedWorktreeBranch: input.associatedWorktreeBranch,
    associatedWorktreeRef: input.associatedWorktreeRef,
    ...(input.targetMode === "worktree" ? { createBranchFlowCompleted: false } : {}),
  };
}
