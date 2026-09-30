import { ServiceMap, Effect, Option } from "effect";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { TurnCheckpointCoordinator } from "../Services/TurnCheckpointCoordinator.ts";
import { ProviderService } from "../../provider/Services/ProviderService.ts";
import {
  type OrchestrationThread,
  type OrchestrationProjectShell,
} from "@glade/contracts/orchestration/threadEntities";
import { resolveThreadWorkspaceCwd } from "../../checkpointing/Utils.ts";
import { ThreadId } from "@glade/contracts/core/baseSchemas";
import { resolveProviderSessionThread as resolveProviderSessionThreadFromProjection } from "../providerSessionThread.ts";

export function makeProviderProjectionAccess(input: {
  readonly projectionSnapshotQuery: ServiceMap.Service.Shape<typeof ProjectionSnapshotQuery>;
  readonly turnCheckpointCoordinator: ServiceMap.Service.Shape<typeof TurnCheckpointCoordinator>;
  readonly providerService: ServiceMap.Service.Shape<typeof ProviderService>;
}) {
  const { projectionSnapshotQuery, turnCheckpointCoordinator, providerService } = input;
  const resolveThreadWorkspaceProject = Effect.fnUntraced(function* (
    thread: Pick<OrchestrationThread, "projectId">,
  ): Effect.fn.Return<OrchestrationProjectShell | undefined> {
    return Option.getOrUndefined(
      yield* projectionSnapshotQuery
        .getProjectShellById(thread.projectId)
        .pipe(Effect.catch(() => Effect.succeed(Option.none()))),
    );
  });

  const resolveProjectedThreadWorkspaceCwd = Effect.fnUntraced(function* (
    thread: Pick<
      OrchestrationThread,
      "projectId" | "envMode" | "worktreePath" | "workingDirectory"
    >,
  ): Effect.fn.Return<string | undefined> {
    const project = yield* resolveThreadWorkspaceProject(thread);
    if (!project) {
      return undefined;
    }
    return resolveThreadWorkspaceCwd({
      thread,
      projects: [project],
    });
  });

  const resolveThread = Effect.fnUntraced(function* (threadId: ThreadId) {
    return Option.getOrUndefined(yield* projectionSnapshotQuery.getThreadDetailById(threadId));
  });

  const resolveProviderSessionThread = (threadId: ThreadId) =>
    resolveProviderSessionThreadFromProjection(projectionSnapshotQuery, threadId);

  const withProviderSessionLease = <A, E, R>(threadId: ThreadId, effect: Effect.Effect<A, E, R>) =>
    resolveProviderSessionThread(threadId).pipe(
      Effect.flatMap((providerThread) =>
        turnCheckpointCoordinator.withThreadLease(providerThread?.id ?? threadId, effect),
      ),
    );

  const resolveSubagentProviderThreadId = (
    threadId: ThreadId,
    parentThreadId: ThreadId | null | undefined,
  ): string | undefined => {
    if (!parentThreadId) {
      return undefined;
    }

    const prefix = `subagent:${parentThreadId}:`;
    const rawThreadId = threadId as string;
    return rawThreadId.startsWith(prefix) ? rawThreadId.slice(prefix.length) : undefined;
  };

  const resolveLiveProviderTurnId = Effect.fnUntraced(function* (threadId: ThreadId) {
    const providerThread = yield* resolveProviderSessionThread(threadId);
    const sessionThreadId = providerThread?.id ?? threadId;
    const session = yield* providerService
      .listSessions()
      .pipe(Effect.map((sessions) => sessions.find((entry) => entry.threadId === sessionThreadId)));
    return session?.status === "running" ? session.activeTurnId : undefined;
  });

  const hasLiveProviderTurn = (threadId: ThreadId) =>
    resolveLiveProviderTurnId(threadId).pipe(Effect.map((turnId) => turnId !== undefined));
  return {
    resolveThread,
    resolveProjectedThreadWorkspaceCwd,
    hasLiveProviderTurn,
    resolveProviderSessionThread,
    resolveSubagentProviderThreadId,
    resolveLiveProviderTurnId,
    withProviderSessionLease,
  };
}
