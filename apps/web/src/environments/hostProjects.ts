import type { ProjectId, ProviderKind } from "@glade/contracts/core/baseSchemas";
import { workspaceRootsEqual } from "@glade/shared/threads/threadWorkspace";
import { createOrRecoverProjectFromPath } from "../lib/projectCreation";
import { newCommandId, newProjectId } from "../lib/utils";
import type { EnvironmentKey } from "./environmentKey";
import { remoteEnvironment } from "./remoteEnvironments";

// Registers a folder on an SSH host as a project of that host's server. The host's own stream would
// deliver the project too; applying the returned snapshot shows it before the next shell event.
export async function addProjectOnHost(input: {
  readonly environmentKey: EnvironmentKey;
  readonly workspaceRoot: string;
  readonly defaultProvider: ProviderKind;
}): Promise<ProjectId> {
  const environment = remoteEnvironment(input.environmentKey);
  const api = environment?.api?.api;
  if (!environment || !api) throw new Error("Connect to the host before adding a project.");
  const result = await createOrRecoverProjectFromPath({
    api,
    workspaceRoot: input.workspaceRoot,
    createIfMissing: true,
    defaultProvider: input.defaultProvider,
    loadSnapshot: () => api.orchestration.getShellSnapshot().catch(() => null),
  });
  if (result.snapshot) environment.store.getState().syncServerShellSnapshot(result.snapshot);
  return result.projectId;
}

const HOST_HYDRATION_TIMEOUT_MS = 15_000;

async function waitForHostHydration(environmentKey: EnvironmentKey): Promise<void> {
  const deadline = Date.now() + HOST_HYDRATION_TIMEOUT_MS;
  while (!remoteEnvironment(environmentKey)?.store.getState().threadsHydrated) {
    if (Date.now() > deadline) throw new Error("The host is still loading its projects.");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

// The host's container for chats that are not about a project, like the local server's Home chats.
// It is looked up only after the host's projects loaded, so it is never created twice.
export async function ensureHostChatProject(environmentKey: EnvironmentKey): Promise<ProjectId> {
  await waitForHostHydration(environmentKey);
  const environment = remoteEnvironment(environmentKey);
  const api = environment?.api?.api;
  const homeDir = environment?.workspacePaths?.homeDir;
  if (!environment || !api || !homeDir) throw new Error("Connect to the host first.");
  const existing = environment.store
    .getState()
    .projects.find(
      (project) => project.kind === "chat" && workspaceRootsEqual(project.cwd, homeDir),
    );
  if (existing) return existing.id;
  const projectId = newProjectId();
  await api.orchestration.dispatchCommand({
    type: "project.create",
    commandId: newCommandId(),
    projectId,
    kind: "chat",
    title: "Home",
    workspaceRoot: homeDir,
    createdAt: new Date().toISOString(),
  });
  environment.store.getState().syncServerShellSnapshot(await api.orchestration.getShellSnapshot());
  return projectId;
}
