import type {
  OrchestrationCommand,
  OrchestrationPendingInteraction,
  OrchestrationThreadActivity,
  OrchestrationSession,
  RuntimeMode,
} from "@glade/contracts/orchestration/orchestration";
import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import { CommandId, EventId } from "@glade/contracts/core/baseSchemas";
import { createStalePendingInteractionMatcher } from "@glade/shared/threads/pendingInteractions";
import {
  derivePendingThreadRequestIds,
  type PendingThreadRequestKind,
} from "@glade/shared/threads/threadSummary";
import { Array as Arr, Effect, Option } from "effect";
import type { ProjectionPendingInteraction } from "../persistence/Services/ProjectionPendingInteractions.ts";
import { ProjectionPendingInteractionRepository } from "../persistence/Services/ProjectionPendingInteractions.ts";
import {
  CHECKPOINT_REVERT_FAILED_ACTIVITY_KIND,
  threadHasCheckpointRevertInProgress,
  threadHasInFlightTurn,
} from "./commandInvariants.ts";
import {
  buildStalePendingRequestSettlementCommand,
  isUnsettledPendingInteraction,
  pendingInteractionRequestKind,
  type ThreadActivityAppendCommand,
} from "./stalePendingInteractions.ts";
import { OrchestrationEngineService } from "./Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "./Services/ProjectionSnapshotQuery.ts";

type ThreadSessionSetCommand = Extract<
  OrchestrationCommand,
  { readonly type: "thread.session.set" }
>;
type RestartReconciliationCommand = ThreadSessionSetCommand | ThreadActivityAppendCommand;

export type ReconcilablePendingInteraction = Pick<
  ProjectionPendingInteraction,
  "threadId" | "interactionKind" | "requestId" | "status"
>;

export interface ReconcilableThread {
  readonly id: ThreadId;
  readonly runtimeMode: RuntimeMode;
  readonly session: OrchestrationSession | null;
  readonly latestTurn: { readonly state: "running" | "interrupted" | "completed" | "error" } | null;
  readonly activities?: ReadonlyArray<
    Pick<OrchestrationThreadActivity, "createdAt" | "id" | "kind" | "payload" | "sequence">
  >;
  readonly pendingInteractions?:
    | ReadonlyArray<
        Pick<
          OrchestrationPendingInteraction,
          "interactionKind" | "requestId" | "lifecycleGeneration" | "status" | "createdAt"
        >
      >
    | undefined;
}

function needsRestartReconciliation(thread: ReconcilableThread): boolean {
  return threadHasInFlightTurn(thread) || hasDanglingActiveTurn(thread);
}

function hasDanglingActiveTurn(thread: ReconcilableThread): boolean {
  return thread.session?.activeTurnId != null && !threadHasInFlightTurn(thread);
}

function planStalePendingRequestCommands(input: {
  readonly thread: ReconcilableThread;
  readonly pendingInteractions: ReadonlyArray<ReconcilablePendingInteraction>;
  readonly now: string;
}): ReadonlyArray<ThreadActivityAppendCommand> {
  const commands: ThreadActivityAppendCommand[] = [];
  if (input.thread.pendingInteractions !== undefined) {
    const isAlreadyStale = createStalePendingInteractionMatcher(input.thread.activities ?? []);
    for (const interaction of input.thread.pendingInteractions) {
      if (
        interaction.status === "confirmed" ||
        isAlreadyStale(interaction) ||
        (interaction.status === "uncertain" && interaction.interactionKind === "approval")
      ) {
        continue;
      }
      commands.push(
        buildStalePendingRequestCommand({
          threadId: input.thread.id,
          now: input.now,
          requestKind: interaction.interactionKind === "approval" ? "approval" : "user-input",
          requestId: interaction.requestId,
          ...(interaction.lifecycleGeneration !== null
            ? { lifecycleGeneration: interaction.lifecycleGeneration }
            : {}),
        }),
      );
    }
    return commands;
  }

  const pendingRequestIds = derivePendingThreadRequestIds({
    activities: input.thread.activities ?? [],
  });
  const plannedRequests = new Set<string>();
  const planRequest = (requestKind: PendingThreadRequestKind, requestId: string) => {
    const requestKey = `${requestKind}:${requestId}`;
    if (plannedRequests.has(requestKey)) {
      return;
    }
    plannedRequests.add(requestKey);
    commands.push(
      buildStalePendingRequestCommand({
        threadId: input.thread.id,
        now: input.now,
        requestKind,
        requestId,
      }),
    );
  };

  for (const requestId of pendingRequestIds.approvalRequestIds) {
    planRequest("approval", requestId);
  }

  for (const requestId of pendingRequestIds.userInputRequestIds) {
    planRequest("user-input", requestId);
  }

  for (const row of input.pendingInteractions) {
    if (row.threadId !== input.thread.id || !isUnsettledPendingInteraction(row)) {
      continue;
    }
    planRequest(pendingInteractionRequestKind(row.interactionKind), row.requestId);
  }

  return commands;
}

function planStaleCheckpointRevertCommand(input: {
  readonly thread: ReconcilableThread;
  readonly now: string;
}): ThreadActivityAppendCommand | null {
  if (!threadHasCheckpointRevertInProgress({ activities: input.thread.activities ?? [] })) {
    return null;
  }
  const commandKey = `restart-reconcile-checkpoint-revert:${input.thread.id}:${input.now}`;
  return {
    type: "thread.activity.append",
    commandId: CommandId.makeUnsafe(commandKey),
    threadId: input.thread.id,
    activity: {
      id: EventId.makeUnsafe(commandKey),
      tone: "error",
      kind: CHECKPOINT_REVERT_FAILED_ACTIVITY_KIND,
      summary: "Checkpoint revert failed",
      payload: { detail: "Checkpoint revert was interrupted by a server restart." },
      turnId: null,
      createdAt: input.now,
    },
    createdAt: input.now,
  };
}

function buildStalePendingRequestCommand(input: {
  readonly threadId: ThreadId;
  readonly now: string;
  readonly requestKind: PendingThreadRequestKind;
  readonly requestId: string;
  readonly lifecycleGeneration?: string;
}): ThreadActivityAppendCommand {
  const commandKey = [
    "restart-reconcile",
    input.threadId,
    input.requestKind,
    input.requestId,
    input.now,
  ].join(":");
  return buildStalePendingRequestSettlementCommand({
    threadId: input.threadId,
    commandId: CommandId.makeUnsafe(commandKey),
    requestKind: input.requestKind,
    requestId: input.requestId,
    ...(input.lifecycleGeneration !== undefined
      ? { lifecycleGeneration: input.lifecycleGeneration }
      : {}),
    now: input.now,
  });
}

// Inject the startup time so repeated reconciliation produces identical command IDs and receipt
// deduplication remains effective.
export function planRestartTurnReconciliation(input: {
  readonly threads: ReadonlyArray<ReconcilableThread>;
  readonly pendingInteractions?: ReadonlyArray<ReconcilablePendingInteraction>;
  readonly now: string;
}): ReadonlyArray<RestartReconciliationCommand> {
  const pendingInteractions = input.pendingInteractions ?? [];
  const pendingByThread = new Map<string, ReconcilablePendingInteraction[]>();
  for (const row of pendingInteractions) {
    const rows = pendingByThread.get(row.threadId) ?? [];
    rows.push(row);
    pendingByThread.set(row.threadId, rows);
  }
  const commands: RestartReconciliationCommand[] = [];
  for (const thread of input.threads) {
    const hasInFlightTurn = threadHasInFlightTurn(thread);
    commands.push(
      ...planStalePendingRequestCommands({
        thread,
        pendingInteractions: pendingByThread.get(thread.id) ?? [],
        now: input.now,
      }),
    );
    const staleCheckpointRevertCommand = planStaleCheckpointRevertCommand({
      thread,
      now: input.now,
    });
    if (staleCheckpointRevertCommand !== null) {
      commands.push(staleCheckpointRevertCommand);
    }
    if (!hasInFlightTurn) {
      if (!hasDanglingActiveTurn(thread)) {
        continue;
      }

      commands.push({
        type: "thread.session.set",
        commandId: CommandId.makeUnsafe(`restart-reconcile-active-turn:${thread.id}:${input.now}`),
        threadId: thread.id,
        session: {
          threadId: thread.id,
          status: thread.session?.status ?? "interrupted",
          providerName: thread.session?.providerName ?? null,
          runtimeMode: thread.session?.runtimeMode ?? thread.runtimeMode,
          activeTurnId: null,
          lastError: thread.session?.lastError ?? null,
          updatedAt: input.now,
        },
        createdAt: input.now,
      });
      continue;
    }
    commands.push({
      type: "thread.session.set",
      commandId: CommandId.makeUnsafe(`restart-reconcile:${thread.id}:${input.now}`),
      threadId: thread.id,
      session: {
        threadId: thread.id,
        status: "interrupted",
        providerName: thread.session?.providerName ?? null,

        runtimeMode: thread.session?.runtimeMode ?? thread.runtimeMode,
        activeTurnId: null,

        lastError: null,
        updatedAt: input.now,
      },
      createdAt: input.now,
    });
  }
  return commands;
}

// Use the live engine read model rather than blocking startup on a second, staler database load.
// Read pending interactions once so requests created by this process cannot enter orphan cleanup.
// Individual failures are logged without preventing startup.
export const reconcileRestartStuckTurns: Effect.Effect<
  void,
  never,
  OrchestrationEngineService | ProjectionSnapshotQuery | ProjectionPendingInteractionRepository
> = Effect.gen(function* () {
  const engine = yield* OrchestrationEngineService;
  const snapshotQuery = yield* ProjectionSnapshotQuery;
  const readModel = yield* engine.getReadModel();

  const pendingInteractions = yield* ProjectionPendingInteractionRepository;
  const unsettled = yield* pendingInteractions
    .listUnsettled({})
    .pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("failed to read restart-orphaned callbacks", { cause }).pipe(
          Effect.as([]),
        ),
      ),
    );
  const unsettledByThread = new Map(Object.entries(Arr.groupBy(unsettled, (row) => row.threadId)));
  const now = new Date().toISOString();
  const threadsNeedingRestartCleanup = readModel.threads.filter(
    (thread) =>
      needsRestartReconciliation(thread) ||
      threadHasCheckpointRevertInProgress(thread) ||
      thread.hasPendingApprovals ||
      thread.hasPendingUserInput ||
      unsettledByThread.has(thread.id),
  );
  if (threadsNeedingRestartCleanup.length === 0) {
    return;
  }

  const reconcilableThreads = yield* Effect.forEach(
    threadsNeedingRestartCleanup,
    (thread) => {
      const pendingInteractions = unsettledByThread.get(thread.id);
      const fallback = pendingInteractions ? { ...thread, pendingInteractions } : thread;
      return snapshotQuery.getThreadDetailById(thread.id).pipe(
        Effect.map((detail) => Option.getOrElse(detail, () => fallback)),
        Effect.catchCause((cause) =>
          Effect.logWarning("restart turn reconciliation continuing without thread activities", {
            threadId: thread.id,
            cause,
          }).pipe(Effect.as(fallback)),
        ),
      );
    },
    { concurrency: 4 },
  );

  const commands = planRestartTurnReconciliation({
    threads: reconcilableThreads,
    pendingInteractions: unsettled,
    now,
  });
  if (commands.length === 0) {
    return;
  }

  yield* Effect.logInfo("reconciling restart-stuck turns", {
    commandCount: commands.length,
    threadCount: threadsNeedingRestartCleanup.length,
    threadIds: threadsNeedingRestartCleanup.map((thread) => thread.id),
  });

  yield* Effect.forEach(
    commands,
    (command) =>
      engine.dispatch(command).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("failed to reconcile restart-stuck turn", {
            threadId: command.threadId,
            cause,
          }),
        ),
      ),
    { discard: true },
  );
});
