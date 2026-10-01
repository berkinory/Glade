import { CommandId, EventId, ThreadId } from "@glade/contracts/core/baseSchemas";
import { Effect, Option } from "effect";
import type { OrchestrationEngineShape } from "../orchestration/Services/OrchestrationEngine.ts";
import type { ProjectionSnapshotQueryShape } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import type { ProjectionTurnRepositoryShape } from "../persistence/Services/ProjectionTurns.ts";
import type { CompletionRepository } from "./completionRepository.ts";
import { summarizeWaitThreadText } from "./threadSummary.ts";

interface CompletionDeliveryDependencies {
  readonly repository: CompletionRepository;
  readonly snapshotQuery: ProjectionSnapshotQueryShape;
  readonly projectionTurns: ProjectionTurnRepositoryShape;
  readonly orchestrationEngine: OrchestrationEngineShape;
}

export const deliverGatewayCompletions = (dependencies: CompletionDeliveryDependencies) =>
  Effect.gen(function* () {
    const { repository, snapshotQuery, projectionTurns, orchestrationEngine } = dependencies;
    for (const row of yield* repository.pending()) {
      yield* Effect.gen(function* () {
        const childThreadId = ThreadId.makeUnsafe(row.childThreadId);

        if (row.resultJson === null && !(yield* repository.isOutputSettled(row.childThreadId)))
          return;
        const child = Option.getOrUndefined(yield* snapshotQuery.getThreadShellById(childThreadId));
        let resultJson = row.resultJson;
        if (resultJson === null) {
          const turns = yield* projectionTurns.listByThreadId({ threadId: childThreadId });

          const turn = turns.find(
            (entry) => entry.pendingMessageId === row.initialMessageId && entry.turnId !== null,
          );
          const failure = turn
            ? null
            : yield* repository.initialFailure(row.childThreadId, row.initialMessageId);
          const failedBeforeStart = failure !== null;
          if (
            child &&
            !failedBeforeStart &&
            (!turn || !["completed", "error", "interrupted"].includes(turn.state))
          )
            return;
          if (
            turn?.state === "completed" &&
            turn.turnId &&
            !(yield* repository.hasCompletedRun(row.childThreadId, turn.turnId))
          )
            return;

          const detail = child
            ? Option.getOrUndefined(yield* snapshotQuery.getThreadDetailById(childThreadId))
            : undefined;
          const summary = summarizeWaitThreadText(
            detail?.messages.findLast(
              (message) =>
                message.role === "assistant" &&
                turn?.turnId != null &&
                message.turnId === turn.turnId,
            )?.text,
          );
          const error = !child
            ? "Child task was deleted."
            : turn?.state === "error" || failedBeforeStart
              ? (failure?.error ??
                (child.latestTurn?.turnId === turn?.turnId ? child.session?.lastError : null) ??
                (failure && failure.status !== "error"
                  ? "Initial run interrupted before provider start."
                  : "Initial run failed."))
              : null;
          resultJson = JSON.stringify({
            childThreadId: row.childThreadId,
            initialMessageId: row.initialMessageId,
            completedAt: turn?.completedAt ?? failure?.completedAt ?? new Date().toISOString(),
            runId: turn?.turnId ?? null,
            status: child
              ? (turn?.state ?? (failure && failure.status !== "error" ? "interrupted" : "error"))
              : "interrupted",
            provider: child?.modelSelection.provider ?? null,
            model: child?.modelSelection.model ?? null,
            summary: summary.summary,
            summaryTruncated: summary.truncated,
            error: error?.slice(0, 2000) ?? null,
            errorTruncated: (error?.length ?? 0) > 2000,
            readThread: { tool: "glade_read_thread", arguments: { threadId: row.childThreadId } },
          });
          yield* repository.saveResult(row.childThreadId, resultJson);
        }
        const result = JSON.parse(resultJson) as {
          status: string;
          completedAt?: string;
          summary: string | null;
          error: string | null;
        };
        const payload = {
          ...JSON.parse(resultJson),
          detail: `Child: ${row.childThreadId}\n${result.error ?? result.summary ?? "No final response."}\nFull result: glade_read_thread(${row.childThreadId})`,
        };
        const parentId = ThreadId.makeUnsafe(row.creatorThreadId);
        const parent = Option.getOrUndefined(yield* snapshotQuery.getThreadShellById(parentId));
        const available = parent !== undefined && parent.archivedAt == null;

        const createdAt = result.completedAt ?? row.createdAt;
        if (available) {
          yield* orchestrationEngine.dispatch({
            type: "thread.activity.append",
            commandId: CommandId.makeUnsafe(`gateway-completion:${row.childThreadId}`),
            threadId: parentId,
            requireUnarchived: true,
            activity: {
              id: EventId.makeUnsafe(`gateway-completion:${row.childThreadId}`),
              kind: "glade.task.completed",
              tone: result.status === "error" ? "error" : "info",
              summary: `Delegated task ${result.status}`,
              payload,
              turnId: null,
              createdAt,
            },
            createdAt,
          });
        }
        if (!available && child) {
          yield* orchestrationEngine.dispatch({
            type: "thread.activity.append",
            commandId: CommandId.makeUnsafe(`gateway-completion-unavailable:${row.childThreadId}`),
            threadId: childThreadId,
            activity: {
              id: EventId.makeUnsafe(`gateway-completion-unavailable:${row.childThreadId}`),
              kind: "glade.task.delivery-unavailable",
              tone: "info",
              summary: "Completion delivery unavailable: creator was archived or deleted",
              payload,
              turnId: null,
              createdAt,
            },
            createdAt,
          });
        }
        yield* repository.delivered(row.childThreadId, available);
      }).pipe(
        Effect.catch((error) =>
          Effect.logWarning("gateway completion delivery will retry", {
            childThreadId: row.childThreadId,
            error,
          }),
        ),
      );
    }
  });
