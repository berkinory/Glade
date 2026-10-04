import type { OrchestrationCommand } from "@glade/contracts/orchestration/commands";
import type { OrchestrationThread } from "@glade/contracts/orchestration/threadEntities";
import { autoRuntimeModeSelectionIssue } from "@glade/shared/threads/runtimeMode";
import { Effect } from "effect";
import { OrchestrationCommandInvariantError } from "../Errors.ts";
import {
  deriveAssociatedWorktreeMetadata,
  deriveAssociatedWorktreeMetadataPatch,
} from "@glade/shared/threads/threadWorkspace";

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
  Extract<OrchestrationCommand, { type: "thread.create" | "thread.fork.create" }>,
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
