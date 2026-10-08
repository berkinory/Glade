import type { ServerWorkspacePaths } from "../lib/serverWorkspacePaths";
import type { Project } from "../types";
import { useRemoteEnvironments } from "./remoteEnvironments";

const UNKNOWN_PATHS: ServerWorkspacePaths = { homeDir: null, chatWorkspaceRoot: null };

// Whether a project is a Home chat container depends on its own machine's home folder. A host whose
// paths are not known yet reports none, which makes the project's kind decide.
export function useProjectWorkspacePathsOf(
  localPaths: ServerWorkspacePaths,
): (project: Pick<Project, "environmentKey">) => ServerWorkspacePaths {
  const environments = useRemoteEnvironments();
  return (project) =>
    project.environmentKey === undefined
      ? localPaths
      : (environments.find((environment) => environment.key === project.environmentKey)
          ?.workspacePaths ?? UNKNOWN_PATHS);
}
