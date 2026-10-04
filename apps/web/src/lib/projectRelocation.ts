import { CommandId, type ProjectId } from "@glade/contracts/core/baseSchemas";
import { type NativeApi } from "@glade/contracts/ipc/ipc";

type ProjectRelocationApi = Pick<
  NativeApi["orchestration"],
  "getShellSnapshot" | "dispatchCommand"
>;

export async function relocateProjectFromClient(
  api: ProjectRelocationApi,
  input: {
    readonly projectId: ProjectId;
    readonly previousWorkspaceRoot: string;
    readonly workspaceRoot: string;
  },
): Promise<void> {
  const workspaceRoot = input.workspaceRoot.trim();
  if (!workspaceRoot) throw new Error("Enter the restored project's folder path.");
  const snapshot = await api.getShellSnapshot();
  const project = snapshot.projects.find((candidate) => candidate.id === input.projectId);
  if (!project || project.kind !== "project")
    throw new Error("This project is no longer available.");
  if (project.workspaceRoot !== input.previousWorkspaceRoot) {
    throw new Error("The project path changed elsewhere. Close this dialog and try again.");
  }
  if (workspaceRoot === project.workspaceRoot) return;
  await api.dispatchCommand({
    type: "project.meta.update",
    commandId: CommandId.makeUnsafe(crypto.randomUUID()),
    projectId: project.id,
    workspaceRoot,
    createWorkspaceRootIfMissing: false,
  });
}
