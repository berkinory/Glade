import type {
  WorkspaceRestoreConfirmation,
  WorkspaceRestorePreview,
} from "@glade/contracts/orchestration/workspaceRestore";

export async function confirmWorkspaceRestore(
  preview: WorkspaceRestorePreview,
  confirm: (message: string) => Promise<boolean>,
): Promise<WorkspaceRestoreConfirmation | null> {
  const overwritePaths: string[] = [];
  for (const file of preview.files.filter((entry) => entry.conflict)) {
    if (
      !(await confirm(
        `Restore anyway: ${file.path}?\n\nThis file changed after the agent's turn. Restoring it will overwrite those later edits. Cancel keeps the workspace and conversation untouched.`,
      ))
    )
      return null;
    overwritePaths.push(file.path);
  }
  const files = preview.files.length
    ? preview.files
        .map((file) => `${file.path}${file.conflict ? " (restore anyway)" : ""}`)
        .join("\n")
    : "No workspace files will be restored.";
  if (
    !(await confirm(
      `Restore these files?\n\n${files}\n\nOnly these files will be restored. Continue with the conversation action?`,
    ))
  )
    return null;
  return { fingerprint: preview.fingerprint, overwritePaths };
}
