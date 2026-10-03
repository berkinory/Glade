export function terminalRuntimeEnv(input: {
  cwd: string;
  worktreePath?: string | null;
}): Record<string, string> {
  return {
    GLADE_PROJECT_ROOT: input.cwd,
    ...(input.worktreePath ? { GLADE_WORKTREE_PATH: input.worktreePath } : {}),
  };
}
