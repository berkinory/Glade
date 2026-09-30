import type { OrchestrationCommand } from "@glade/contracts/orchestration/commands";
import type {
  OrchestrationThread,
  ThreadGoalAchievement,
} from "@glade/contracts/orchestration/threadEntities";
import { autoRuntimeModeSelectionIssue } from "@glade/shared/threads/runtimeMode";
import { Effect } from "effect";
import { OrchestrationCommandInvariantError } from "../Errors.ts";
import {
  deriveAssociatedWorktreeMetadata,
  deriveAssociatedWorktreeMetadataPatch,
} from "@glade/shared/threads/threadWorkspace";
import { THREAD_GOAL_ACHIEVEMENTS_MAX_COUNT } from "@glade/contracts/orchestration/threadEntities";

export function validateAutoRuntimeMode(
  command: OrchestrationCommand,
  modelSelection: OrchestrationThread["modelSelection"],
  runtimeMode: OrchestrationThread["runtimeMode"],
) {
  const issue = autoRuntimeModeSelectionIssue({ runtimeMode, modelSelection });
  return issue === null
    ? Effect.void
    : Effect.fail(
        new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: issue,
        }),
      );
}

function deriveCommandAssociatedWorktreeMetadata(input: {
  readonly branch: string | null;
  readonly worktreePath: string | null;
  readonly associatedWorktreePath?: string | null;
  readonly associatedWorktreeBranch?: string | null;
  readonly associatedWorktreeRef?: string | null;
}) {
  return deriveAssociatedWorktreeMetadata({
    branch: input.branch,
    worktreePath: input.worktreePath,
    ...(input.associatedWorktreePath !== undefined
      ? { associatedWorktreePath: input.associatedWorktreePath }
      : {}),
    ...(input.associatedWorktreeBranch !== undefined
      ? { associatedWorktreeBranch: input.associatedWorktreeBranch }
      : {}),
    ...(input.associatedWorktreeRef !== undefined
      ? { associatedWorktreeRef: input.associatedWorktreeRef }
      : {}),
  });
}

function deriveCommandAssociatedWorktreeMetadataPatch(input: {
  readonly branch?: string | null;
  readonly worktreePath?: string | null;
  readonly associatedWorktreePath?: string | null;
  readonly associatedWorktreeBranch?: string | null;
  readonly associatedWorktreeRef?: string | null;
}) {
  return deriveAssociatedWorktreeMetadataPatch({
    ...(input.branch !== undefined ? { branch: input.branch } : {}),
    ...(input.worktreePath !== undefined ? { worktreePath: input.worktreePath } : {}),
    ...(input.associatedWorktreePath !== undefined
      ? { associatedWorktreePath: input.associatedWorktreePath }
      : {}),
    ...(input.associatedWorktreeBranch !== undefined
      ? { associatedWorktreeBranch: input.associatedWorktreeBranch }
      : {}),
    ...(input.associatedWorktreeRef !== undefined
      ? { associatedWorktreeRef: input.associatedWorktreeRef }
      : {}),
  });
}

type CreatedThreadWorkspaceCommand = Pick<
  Extract<
    OrchestrationCommand,
    { type: "thread.create" | "thread.handoff.create" | "thread.fork.create" }
  >,
  | "envMode"
  | "branch"
  | "worktreePath"
  | "workingDirectory"
  | "associatedWorktreePath"
  | "associatedWorktreeBranch"
  | "associatedWorktreeRef"
>;

export function resolveCreatedThreadWorkspaceMetadata(command: CreatedThreadWorkspaceCommand) {
  return {
    envMode: command.envMode,
    branch: command.branch,
    worktreePath: command.worktreePath,
    workingDirectory: command.workingDirectory ?? null,
    ...deriveCommandAssociatedWorktreeMetadata({
      branch: command.branch,
      worktreePath: command.worktreePath,
      ...(command.associatedWorktreePath !== undefined
        ? { associatedWorktreePath: command.associatedWorktreePath }
        : {}),
      ...(command.associatedWorktreeBranch !== undefined
        ? { associatedWorktreeBranch: command.associatedWorktreeBranch }
        : {}),
      ...(command.associatedWorktreeRef !== undefined
        ? { associatedWorktreeRef: command.associatedWorktreeRef }
        : {}),
    }),
  };
}

export function resolveThreadGoalPatch(
  command: Extract<OrchestrationCommand, { type: "thread.meta.update" }>,
  currentThread: OrchestrationThread,
  occurredAt: string,
): {
  goal?: string;
  goalStartedAt?: string | null;
  goalPausedAt?: string | null;
  goalAchievements?: readonly ThreadGoalAchievement[];
} {
  const activeGoal = (currentThread.goal ?? "").trim();
  if (command.goalAchieved === true) {
    if (activeGoal.length === 0) {
      return {};
    }
    const startedMs = Date.parse(currentThread.goalStartedAt ?? "");
    const pausedMs = Date.parse(currentThread.goalPausedAt ?? "");
    const occurredMs = Date.parse(occurredAt);
    const endMs = Number.isFinite(pausedMs) ? pausedMs : occurredMs;
    const elapsedMs =
      Number.isFinite(startedMs) && Number.isFinite(endMs) ? Math.max(0, endMs - startedMs) : null;
    const achievement: ThreadGoalAchievement = {
      goal: activeGoal,
      achievedAt: occurredAt,
      elapsedMs,
      turnId: currentThread.latestTurn?.turnId ?? null,
    };
    return {
      goal: "",
      goalStartedAt: null,
      goalPausedAt: null,
      goalAchievements: [...(currentThread.goalAchievements ?? []), achievement].slice(
        -THREAD_GOAL_ACHIEVEMENTS_MAX_COUNT,
      ),
    };
  }
  if (command.goal !== undefined) {
    if (command.goal.trim().length === 0) {
      return { goal: command.goal, goalStartedAt: null, goalPausedAt: null };
    }
    if (activeGoal.length > 0) {
      return { goal: command.goal };
    }
    return { goal: command.goal, goalStartedAt: occurredAt, goalPausedAt: null };
  }
  if (command.goalPaused === undefined || activeGoal.length === 0) {
    return {};
  }
  const pausedAt = currentThread.goalPausedAt ?? null;
  if (command.goalPaused) {
    return pausedAt === null ? { goalPausedAt: occurredAt } : {};
  }
  if (pausedAt === null) {
    return {};
  }
  const startedMs = Date.parse(currentThread.goalStartedAt ?? "");
  const pausedMs = Date.parse(pausedAt);
  const occurredMs = Date.parse(occurredAt);
  const rebasedStartedAt =
    Number.isFinite(startedMs) && Number.isFinite(pausedMs) && Number.isFinite(occurredMs)
      ? new Date(occurredMs - Math.max(0, pausedMs - startedMs)).toISOString()
      : occurredAt;
  return { goalStartedAt: rebasedStartedAt, goalPausedAt: null };
}

export function resolveThreadWorkspaceMetadataPatch(
  command: Extract<OrchestrationCommand, { type: "thread.meta.update" }>,
) {
  return {
    ...(command.envMode !== undefined ? { envMode: command.envMode } : {}),
    ...(command.branch !== undefined ? { branch: command.branch } : {}),
    ...(command.worktreePath !== undefined ? { worktreePath: command.worktreePath } : {}),
    ...(command.workingDirectory !== undefined
      ? { workingDirectory: command.workingDirectory }
      : {}),
    ...deriveCommandAssociatedWorktreeMetadataPatch({
      ...(command.branch !== undefined ? { branch: command.branch } : {}),
      ...(command.worktreePath !== undefined ? { worktreePath: command.worktreePath } : {}),
      ...(command.associatedWorktreePath !== undefined
        ? { associatedWorktreePath: command.associatedWorktreePath }
        : {}),
      ...(command.associatedWorktreeBranch !== undefined
        ? { associatedWorktreeBranch: command.associatedWorktreeBranch }
        : {}),
      ...(command.associatedWorktreeRef !== undefined
        ? { associatedWorktreeRef: command.associatedWorktreeRef }
        : {}),
    }),
    ...(command.createBranchFlowCompleted !== undefined
      ? { createBranchFlowCompleted: command.createBranchFlowCompleted }
      : {}),
  };
}
