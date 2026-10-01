import { Effect, ServiceMap } from "effect";
import type { ThreadId, TurnId } from "@glade/contracts/core/baseSchemas";
import type {
  OrchestrationThread,
  OrchestrationThreadShell,
} from "@glade/contracts/orchestration/threadEntities";
import type { ProjectionRepositoryError } from "../../persistence/Errors.ts";

export interface ProviderProjectionAccessShape {
  readonly resolveThread: (
    threadId: ThreadId,
  ) => Effect.Effect<OrchestrationThread | undefined, ProjectionRepositoryError>;
  readonly resolveProjectedThreadWorkspaceCwd: (
    thread: Pick<
      OrchestrationThread,
      "projectId" | "envMode" | "worktreePath" | "workingDirectory"
    >,
  ) => Effect.Effect<string | undefined>;
  readonly hasLiveProviderTurn: (
    threadId: ThreadId,
  ) => Effect.Effect<boolean, ProjectionRepositoryError>;
  readonly resolveProviderSessionThread: (
    threadId: ThreadId,
  ) => Effect.Effect<OrchestrationThreadShell | null, ProjectionRepositoryError>;
  readonly resolveSubagentProviderThreadId: (
    threadId: ThreadId,
    parentThreadId: ThreadId | null | undefined,
  ) => string | undefined;
  readonly resolveLiveProviderTurnId: (
    threadId: ThreadId,
  ) => Effect.Effect<TurnId | undefined, ProjectionRepositoryError>;
  readonly withProviderSessionLease: <A, E, R>(
    threadId: ThreadId,
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | ProjectionRepositoryError, R>;
}

export class ProviderProjectionAccess extends ServiceMap.Service<
  ProviderProjectionAccess,
  ProviderProjectionAccessShape
>()("glade/orchestration/Services/ProviderProjectionAccess") {}
