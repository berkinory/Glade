import type { OrchestrationReadModel } from "@glade/contracts/orchestration/orchestration";
import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import type { ProjectImportOrigin } from "../persistence/projectImportRepository";

export function makeProjectImportDestinations(
  model: Pick<OrchestrationReadModel, "projects" | "threads">,
) {
  const projects = new Set(
    model.projects.filter((project) => project.deletedAt === null).map((project) => project.id),
  );
  const threads = new Map(model.threads.map((thread) => [thread.id, thread]));

  const findThread = (threadId: ThreadId) => {
    const thread = threads.get(threadId);
    if (!thread || thread.deletedAt !== null || !projects.has(thread.projectId)) return undefined;
    return { threadId, projectId: thread.projectId };
  };

  const findOrigin = (origin: ProjectImportOrigin | undefined): ProjectImportOrigin | undefined => {
    if (!origin) return undefined;
    const destination = findThread(origin.threadId);
    if (destination) return { ...origin, ...destination };

    if (
      origin.status === "pending" &&
      !threads.has(origin.threadId) &&
      projects.has(origin.projectId)
    ) {
      return origin;
    }
    return undefined;
  };

  return { findThread, findOrigin };
}
