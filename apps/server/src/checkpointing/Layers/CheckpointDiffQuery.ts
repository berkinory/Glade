import { scopedTurnCheckpoints } from "../scopedTurnCheckpoints";
import { collectTailTurnIds } from "@glade/shared/threads/conversationEdit";
import {
  OrchestrationGetTurnDiffResult,
  type OrchestrationGetFullThreadDiffInput,
  type OrchestrationGetFullThreadDiffResult,
  type OrchestrationGetTurnDiffResult as OrchestrationGetTurnDiffResultType,
} from "@glade/contracts/orchestration/rpc";
import { Effect, Layer, Option, Schema } from "effect";

import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { CheckpointInvariantError, CheckpointUnavailableError } from "../Errors.ts";
import {
  checkpointRefForThreadTurn,
  checkpointRefForThreadTurnInManagedFamily,
  checkpointRefForThreadTurnStart,
  checkpointRefForThreadTurnStartInManagedFamily,
  resolveThreadWorkspaceCwd,
} from "../Utils.ts";
import { CheckpointStore } from "../Services/CheckpointStore.ts";
import {
  CheckpointDiffQuery,
  type CheckpointDiffQueryShape,
} from "../Services/CheckpointDiffQuery.ts";

const isTurnDiffResult = Schema.is(OrchestrationGetTurnDiffResult);

function buildTurnDiffResult(input: {
  readonly threadId: OrchestrationGetTurnDiffResultType["threadId"];
  readonly fromTurnCount: number;
  readonly toTurnCount: number;
  readonly diff: string;
}): OrchestrationGetTurnDiffResultType {
  return {
    threadId: input.threadId,
    fromTurnCount: input.fromTurnCount,
    toTurnCount: input.toTurnCount,
    diff: input.diff,
  };
}

const make = Effect.gen(function* () {
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const checkpointStore = yield* CheckpointStore;

  const previewWorkspaceRestore: CheckpointDiffQueryShape["previewWorkspaceRestore"] = (input) =>
    Effect.gen(function* () {
      const detail = yield* projectionSnapshotQuery.getThreadDetailById(input.threadId);
      if (Option.isNone(detail))
        return yield* new CheckpointInvariantError({
          operation: "previewWorkspaceRestore",
          detail: "Conversation is unavailable.",
        });
      const thread = detail.value;
      const project = yield* projectionSnapshotQuery.getProjectShellById(thread.projectId);
      if (Option.isNone(project))
        return yield* new CheckpointInvariantError({
          operation: "previewWorkspaceRestore",
          detail: "Project is unavailable.",
        });
      const cwd = resolveThreadWorkspaceCwd({ thread, projects: [project.value] });
      if (!cwd)
        return yield* new CheckpointInvariantError({
          operation: "previewWorkspaceRestore",
          detail: "Conversation has no workspace.",
        });
      const target = input.target;
      const removedTurnIds =
        target.type === "edit"
          ? collectTailTurnIds({ messages: thread.messages, messageId: target.messageId })
          : [];
      const checkpoints = thread.checkpoints.filter((checkpoint) =>
        target.type === "revert"
          ? checkpoint.checkpointTurnCount > target.turnCount
          : target.type === "undoFiles"
            ? checkpoint.checkpointTurnCount === target.turnCount
            : removedTurnIds.includes(checkpoint.turnId),
      );
      return yield* checkpointStore.previewScopedRestore({
        cwd,
        turns: scopedTurnCheckpoints(thread, checkpoints),
      });
    }).pipe(
      Effect.mapError(
        (cause) =>
          new CheckpointInvariantError({
            operation: "previewWorkspaceRestore",
            detail: cause.message,
            cause,
          }),
      ),
    );

  const getTurnDiff: CheckpointDiffQueryShape["getTurnDiff"] = (input) =>
    Effect.gen(function* () {
      const operation = "CheckpointDiffQuery.getTurnDiff";
      const ignoreWhitespace = input.ignoreWhitespace ?? true;

      if (input.fromTurnCount === input.toTurnCount) {
        const emptyDiff: OrchestrationGetTurnDiffResultType = {
          threadId: input.threadId,
          fromTurnCount: input.fromTurnCount,
          toTurnCount: input.toTurnCount,
          diff: "",
        };
        if (!isTurnDiffResult(emptyDiff)) {
          return yield* new CheckpointInvariantError({
            operation,
            detail: "Computed turn diff result does not satisfy contract schema.",
          });
        }
        return emptyDiff;
      }

      const threadContext = yield* projectionSnapshotQuery.getThreadCheckpointContext(
        input.threadId,
      );
      if (Option.isNone(threadContext)) {
        return yield* new CheckpointInvariantError({
          operation,
          detail: `Thread '${input.threadId}' not found.`,
        });
      }

      const maxTurnCount = threadContext.value.checkpoints.reduce(
        (max, checkpoint) => Math.max(max, checkpoint.checkpointTurnCount),
        0,
      );
      if (input.toTurnCount > maxTurnCount) {
        return yield* new CheckpointUnavailableError({
          threadId: input.threadId,
          turnCount: input.toTurnCount,
          detail: `Turn diff range exceeds current turn count: requested ${input.toTurnCount}, current ${maxTurnCount}.`,
        });
      }

      const workspaceCwd = resolveThreadWorkspaceCwd({
        thread: {
          projectId: threadContext.value.projectId,
          envMode: threadContext.value.envMode,
          worktreePath: threadContext.value.worktreePath,
          workingDirectory: threadContext.value.workingDirectory,
        },
        projects: [
          {
            id: threadContext.value.projectId,
            kind: threadContext.value.projectKind,
            workspaceRoot: threadContext.value.workspaceRoot,
          },
        ],
      });
      if (!workspaceCwd) {
        return yield* new CheckpointInvariantError({
          operation,
          detail: `Workspace path missing for thread '${input.threadId}' when computing turn diff.`,
        });
      }

      const toCheckpoint = threadContext.value.checkpoints.find(
        (checkpoint) => checkpoint.checkpointTurnCount === input.toTurnCount,
      );
      if (!toCheckpoint) {
        return yield* new CheckpointUnavailableError({
          threadId: input.threadId,
          turnCount: input.toTurnCount,
          detail: `Checkpoint ref is unavailable for turn ${input.toTurnCount}.`,
        });
      }

      const fromCheckpoint =
        input.fromTurnCount === 0
          ? null
          : threadContext.value.checkpoints.find(
              (checkpoint) => checkpoint.checkpointTurnCount === input.fromTurnCount,
            );
      if (fromCheckpoint?.status === "missing") {
        return yield* new CheckpointUnavailableError({
          threadId: input.threadId,
          turnCount: input.fromTurnCount,
          detail: `Checkpoint diff is not available yet for turn ${input.fromTurnCount}.`,
        });
      }

      const earliestManagedBaselineRef = threadContext.value.checkpoints
        .toSorted((left, right) => left.checkpointTurnCount - right.checkpointTurnCount)
        .map((checkpoint) =>
          checkpointRefForThreadTurnInManagedFamily(checkpoint.checkpointRef, input.threadId, 0),
        )
        .find((checkpointRef) => checkpointRef !== null);
      let fromCheckpointRef =
        input.fromTurnCount === 0
          ? (earliestManagedBaselineRef ?? checkpointRefForThreadTurn(input.threadId, 0))
          : fromCheckpoint?.checkpointRef;
      if (!fromCheckpointRef) {
        return yield* new CheckpointUnavailableError({
          threadId: input.threadId,
          turnCount: input.fromTurnCount,
          detail: `Checkpoint ref is unavailable for turn ${input.fromTurnCount}.`,
        });
      }

      const toCheckpointRef = toCheckpoint.checkpointRef;
      if (toCheckpoint.status === "missing") {
        return yield* new CheckpointUnavailableError({
          threadId: input.threadId,
          turnCount: input.toTurnCount,
          detail: `Checkpoint diff is not available yet for turn ${input.toTurnCount}.`,
        });
      }
      if (input.toTurnCount === input.fromTurnCount + 1) {
        const turnStartCheckpointRef =
          checkpointRefForThreadTurnStartInManagedFamily(
            toCheckpointRef,
            input.threadId,
            toCheckpoint.turnId,
          ) ?? checkpointRefForThreadTurnStart(input.threadId, toCheckpoint.turnId);
        const turnStartExists = yield* checkpointStore.hasCheckpointRef({
          cwd: workspaceCwd,
          checkpointRef: turnStartCheckpointRef,
        });
        if (turnStartExists) {
          fromCheckpointRef = turnStartCheckpointRef;
        }
      }

      const diff = yield* checkpointStore.diffCheckpoints({
        cwd: workspaceCwd,
        fromCheckpointRef,
        toCheckpointRef,
        fallbackFromToHead: false,
        ignoreWhitespace,
      });

      const turnDiff = buildTurnDiffResult({
        threadId: input.threadId,
        fromTurnCount: input.fromTurnCount,
        toTurnCount: input.toTurnCount,
        diff,
      });
      if (!isTurnDiffResult(turnDiff)) {
        return yield* new CheckpointInvariantError({
          operation,
          detail: "Computed turn diff result does not satisfy contract schema.",
        });
      }

      return turnDiff;
    });

  const getFullThreadDiff: CheckpointDiffQueryShape["getFullThreadDiff"] = (
    input: OrchestrationGetFullThreadDiffInput,
  ) =>
    Effect.gen(function* () {
      const operation = "CheckpointDiffQuery.getFullThreadDiff";
      const ignoreWhitespace = input.ignoreWhitespace ?? true;

      if (input.toTurnCount === 0) {
        const emptyDiff = buildTurnDiffResult({
          threadId: input.threadId,
          fromTurnCount: 0,
          toTurnCount: 0,
          diff: "",
        });
        if (!isTurnDiffResult(emptyDiff)) {
          return yield* new CheckpointInvariantError({
            operation,
            detail: "Computed full thread diff result does not satisfy contract schema.",
          });
        }
        return emptyDiff satisfies OrchestrationGetFullThreadDiffResult;
      }

      const threadContext = yield* projectionSnapshotQuery.getFullThreadDiffContext(
        input.threadId,
        input.toTurnCount,
      );
      if (Option.isNone(threadContext)) {
        return yield* new CheckpointInvariantError({
          operation,
          detail: `Thread '${input.threadId}' not found.`,
        });
      }

      if (input.toTurnCount > threadContext.value.latestCheckpointTurnCount) {
        return yield* new CheckpointUnavailableError({
          threadId: input.threadId,
          turnCount: input.toTurnCount,
          detail: `Turn diff range exceeds current turn count: requested ${input.toTurnCount}, current ${threadContext.value.latestCheckpointTurnCount}.`,
        });
      }

      const workspaceCwd = resolveThreadWorkspaceCwd({
        thread: {
          projectId: threadContext.value.projectId,
          envMode: threadContext.value.envMode,
          worktreePath: threadContext.value.worktreePath,
          workingDirectory: threadContext.value.workingDirectory,
        },
        projects: [
          {
            id: threadContext.value.projectId,
            kind: threadContext.value.projectKind,
            workspaceRoot: threadContext.value.workspaceRoot,
          },
        ],
      });
      if (!workspaceCwd) {
        return yield* new CheckpointInvariantError({
          operation,
          detail: `Workspace path missing for thread '${input.threadId}' when computing full thread diff.`,
        });
      }

      if (!threadContext.value.toCheckpointRef) {
        return yield* new CheckpointUnavailableError({
          threadId: input.threadId,
          turnCount: input.toTurnCount,
          detail: `Checkpoint ref is unavailable for turn ${input.toTurnCount}.`,
        });
      }

      const diff = yield* checkpointStore.diffCheckpoints({
        cwd: workspaceCwd,
        fromCheckpointRef:
          (threadContext.value.baselineCheckpointRef
            ? checkpointRefForThreadTurnInManagedFamily(
                threadContext.value.baselineCheckpointRef,
                input.threadId,
                0,
              )
            : null) ?? checkpointRefForThreadTurn(input.threadId, 0),
        toCheckpointRef: threadContext.value.toCheckpointRef,
        fallbackFromToHead: false,
        ignoreWhitespace,
      });

      const fullThreadDiff = buildTurnDiffResult({
        threadId: input.threadId,
        fromTurnCount: 0,
        toTurnCount: input.toTurnCount,
        diff,
      });
      if (!isTurnDiffResult(fullThreadDiff)) {
        return yield* new CheckpointInvariantError({
          operation,
          detail: "Computed full thread diff result does not satisfy contract schema.",
        });
      }

      return fullThreadDiff satisfies OrchestrationGetFullThreadDiffResult;
    });

  return {
    getTurnDiff,
    previewWorkspaceRestore,
    getFullThreadDiff,
  } satisfies CheckpointDiffQueryShape;
});

export const CheckpointDiffQueryLive = Layer.effect(CheckpointDiffQuery, make);
