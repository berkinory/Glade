import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import type {
  GitActionProgressEvent,
  GitRunStackedActionResult,
  GitStackedAction,
  GitStatusResult,
} from "@glade/contracts/git/git";
import { useCallback, type Dispatch, type SetStateAction } from "react";
import { randomUUID } from "~/lib/utils";
import { readNativeApi } from "~/nativeApi";
import { formatClockDuration } from "~/session-logic";
import {
  buildGitActionProgressStages,
  requiresDefaultBranchConfirmation,
  resolveCreatePrActionAvailability,
  resolveCreatePrExecution,
  summarizeGitResult,
  type DefaultBranchConfirmableAction,
} from "./GitActionsControl.logic";
import { toastManager } from "./ui/toast";

export interface PendingDefaultBranchAction {
  action: DefaultBranchConfirmableAction;
  branchName: string;
  includesCommit: boolean;
  commitMessage?: string;
  forcePushOnlyProgress: boolean;
  onConfirmed?: () => void;
  filePaths?: string[];
}

type GitActionToastId = ReturnType<typeof toastManager.add>;

interface ActiveGitActionProgress {
  toastId: GitActionToastId;
  actionId: string;
  title: string;
  phaseStartedAtMs: number | null;
  hookStartedAtMs: number | null;
  hookName: string | null;
  lastOutputLine: string | null;
  currentPhaseLabel: string | null;
}

export interface RunGitActionWithToastInput {
  action: GitStackedAction;
  commitMessage?: string;
  forcePushOnlyProgress?: boolean;
  onConfirmed?: () => void;
  skipDefaultBranchPrompt?: boolean;
  statusOverride?: GitStatusResult | null;
  featureBranch?: boolean;
  isDefaultBranchOverride?: boolean;
  progressToastId?: GitActionToastId;
  filePaths?: string[];
  prTitle?: string;
  prBody?: string;
  prDraft?: boolean;
  allowDirtyWorkingTree?: boolean;
  afterSuccess?: (result: GitRunStackedActionResult) => void;
}

function formatElapsedDescription(startedAtMs: number | null): string | undefined {
  if (startedAtMs === null) {
    return undefined;
  }
  return `Running for ${formatClockDuration(Date.now() - startedAtMs)}`;
}

function resolveProgressDescription(progress: ActiveGitActionProgress): string | undefined {
  if (progress.lastOutputLine) {
    return progress.lastOutputLine;
  }
  return formatElapsedDescription(progress.hookStartedAtMs ?? progress.phaseStartedAtMs);
}

type RunStackedActionVariables = {
  actionId: string;
  action: GitStackedAction;
  commitMessage?: string;
  featureBranch?: boolean;
  filePaths?: string[];
  prTitle?: string;
  prBody?: string;
  prDraft?: boolean;
  allowDirtyWorkingTree?: boolean;
};

type GitActionRunnerDeps = {
  defaultBranchName: string | null;
  gitStatusForActions: GitStatusResult | null;
  hasOriginRemote: boolean;
  isDefaultBranch: boolean;
  openCreatePrDialog: (input?: {
    statusOverride?: GitStatusResult | null;
    statusOverrideSource?: GitStatusResult | null;
    isDefaultBranchOverride?: boolean;
  }) => void;
  persistThreadPr: (pr: {
    number: number;
    title: string;
    url: string;
    baseBranch: string;
    headBranch: string;
    state: "open" | "closed" | "merged";
    isDraft?: boolean;
    mergeability?: "mergeable" | "conflicting" | "unknown";
    additions?: number | null;
    deletions?: number | null;
    changedFiles?: number | null;
  }) => Promise<void>;
  runAction: (input: RunStackedActionVariables) => Promise<GitRunStackedActionResult>;
  threadToastData: { threadId: ThreadId } | undefined;
  setPendingDefaultBranchAction: Dispatch<SetStateAction<PendingDefaultBranchAction | null>>;
};

export function useGitActionRunner(deps: GitActionRunnerDeps) {
  const {
    defaultBranchName,
    gitStatusForActions,
    hasOriginRemote,
    isDefaultBranch,
    openCreatePrDialog,
    persistThreadPr,
    runAction,
    threadToastData,
    setPendingDefaultBranchAction,
  } = deps;
  return useCallback(
    async function runGitActionWithToast({
      action,
      commitMessage,
      forcePushOnlyProgress: forcePushOnlyProgressProp,
      onConfirmed,
      skipDefaultBranchPrompt: skipDefaultBranchPromptProp,
      statusOverride,
      featureBranch: featureBranchProp,
      isDefaultBranchOverride,
      progressToastId,
      filePaths,
      prTitle,
      prBody,
      prDraft,
      allowDirtyWorkingTree,
      afterSuccess,
    }: RunGitActionWithToastInput) {
      const forcePushOnlyProgress = forcePushOnlyProgressProp ?? false;
      const skipDefaultBranchPrompt = skipDefaultBranchPromptProp ?? false;
      const featureBranch = featureBranchProp ?? false;
      const actionStatus = statusOverride ?? gitStatusForActions;
      const actionBranch = actionStatus?.branch ?? null;
      const actionIsDefaultBranch =
        isDefaultBranchOverride ?? (featureBranch ? false : isDefaultBranch);
      const includesCommit =
        !forcePushOnlyProgress &&
        action !== "push" &&
        action !== "create_pr" &&
        (action === "commit" || !!actionStatus?.hasWorkingTreeChanges);
      const shouldPushBeforePr =
        action === "create_pr" &&
        (!actionStatus?.hasUpstream || (actionStatus?.aheadCount ?? 0) > 0);
      if (
        !skipDefaultBranchPrompt &&
        requiresDefaultBranchConfirmation(action, actionIsDefaultBranch) &&
        actionBranch
      ) {
        setPendingDefaultBranchAction({
          action,
          branchName: actionBranch,
          includesCommit,
          ...(commitMessage ? { commitMessage } : {}),
          forcePushOnlyProgress,
          ...(onConfirmed ? { onConfirmed } : {}),
          ...(filePaths ? { filePaths } : {}),
        });
        return;
      }
      if (action === "create_pr" && !featureBranch && !allowDirtyWorkingTree) {
        const createPrAvailability = resolveCreatePrActionAvailability({
          gitStatus: actionStatus,
          isDefaultBranch: actionIsDefaultBranch,
          hasOriginRemote,
          defaultBranchName,
        });
        if (!createPrAvailability.canRun) {
          toastManager.add({
            type: "info",
            title: "Create PR unavailable",
            description: createPrAvailability.hint ?? "No branch changes to include in a PR.",
            data: threadToastData,
          });
          return;
        }
      }
      onConfirmed?.();

      const progressStages = buildGitActionProgressStages({
        action,
        hasCustomCommitMessage: !!commitMessage?.trim(),
        hasWorkingTreeChanges: !!actionStatus?.hasWorkingTreeChanges,
        forcePushOnly: forcePushOnlyProgress,
        featureBranch,
        shouldPushBeforePr,
      });
      const actionId = randomUUID();
      const resolvedProgressToastId =
        progressToastId ??
        toastManager.add({
          type: "loading",
          title: progressStages[0] ?? "Running git action...",
          description: "Waiting for Git...",
          timeout: 0,
          data: threadToastData,
        });

      const progress: ActiveGitActionProgress = {
        toastId: resolvedProgressToastId,
        actionId,
        title: progressStages[0] ?? "Running git action...",
        phaseStartedAtMs: null,
        hookStartedAtMs: null,
        hookName: null,
        lastOutputLine: null,
        currentPhaseLabel: progressStages[0] ?? "Running git action...",
      };

      if (progressToastId) {
        toastManager.update(progressToastId, {
          type: "loading",
          title: progressStages[0] ?? "Running git action...",
          description: "Waiting for Git...",
          timeout: 0,
          data: threadToastData,
        });
      }

      let failedMessage: string | null = null;
      let failedPhase: string | null = null;
      const updateProgress = () =>
        toastManager.update(resolvedProgressToastId, {
          type: "loading",
          title: progress.title,
          description: resolveProgressDescription(progress),
          timeout: 0,
          data: threadToastData,
        });
      const unsubscribe = readNativeApi()?.git.onActionProgress((event: GitActionProgressEvent) => {
        if (event.actionId !== actionId) return;
        const now = Date.now();
        switch (event.kind) {
          case "action_started":
            progress.phaseStartedAtMs = now;
            break;
          case "phase_started":
            progress.title = event.label;
            progress.currentPhaseLabel = event.label;
            progress.phaseStartedAtMs = now;
            progress.hookStartedAtMs = null;
            progress.hookName = null;
            progress.lastOutputLine = null;
            break;
          case "hook_started":
            progress.title = `Running ${event.hookName}...`;
            progress.hookName = event.hookName;
            progress.hookStartedAtMs = now;
            break;
          case "hook_output":
            progress.lastOutputLine = event.text;
            break;
          case "hook_finished":
            progress.title = progress.currentPhaseLabel ?? "Committing...";
            progress.hookName = null;
            progress.hookStartedAtMs = null;
            progress.lastOutputLine = null;
            break;
          case "action_failed":
            failedMessage = event.message;
            failedPhase = event.phase;
            return;
          case "action_finished":
            return;
        }
        updateProgress();
      });
      const interval = window.setInterval(updateProgress, 1000);

      try {
        const result = await runAction({
          actionId,
          action,
          ...(commitMessage ? { commitMessage } : {}),
          ...(featureBranch ? { featureBranch } : {}),
          ...(filePaths ? { filePaths } : {}),
          ...(prTitle ? { prTitle } : {}),
          ...(prBody ? { prBody } : {}),
          ...(prDraft ? { prDraft } : {}),
          ...(allowDirtyWorkingTree ? { allowDirtyWorkingTree } : {}),
        });

        const resultToast = summarizeGitResult(result);
        const persistedPr =
          result.pr.status === "created" || result.pr.status === "opened_existing"
            ? result.pr.number &&
              result.pr.title &&
              result.pr.url &&
              result.pr.baseBranch &&
              result.pr.headBranch
              ? {
                  number: result.pr.number,
                  title: result.pr.title,
                  url: result.pr.url,
                  baseBranch: result.pr.baseBranch,
                  headBranch: result.pr.headBranch,
                  state: "open" as const,
                }
              : null
            : actionStatus?.pr?.state === "open"
              ? actionStatus.pr
              : null;
        if (persistedPr) {
          void persistThreadPr(persistedPr).catch(() => undefined);
        }

        const existingOpenPrUrl =
          actionStatus?.pr?.state === "open" ? actionStatus.pr.url : undefined;
        const prUrl = result.pr.url ?? existingOpenPrUrl;
        const shouldOfferPushCta = action === "commit" && result.commit.status === "created";
        const shouldOfferOpenPrCta =
          (action === "push" ||
            action === "create_pr" ||
            action === "commit_push" ||
            action === "commit_push_pr") &&
          !!prUrl &&
          (!actionIsDefaultBranch ||
            result.pr.status === "created" ||
            result.pr.status === "opened_existing");
        const postPushStatus = actionStatus
          ? {
              ...actionStatus,
              hasUpstream: true,
              upstreamBranch:
                actionStatus.upstreamBranch ??
                (!actionStatus.hasUpstream ? (result.push.branch ?? actionStatus.branch) : null),
              aheadCount: 0,
            }
          : null;
        const shouldOfferCreatePrCta =
          (action === "push" || action === "commit_push") &&
          !prUrl &&
          result.push.status === "pushed" &&
          !actionIsDefaultBranch &&
          resolveCreatePrExecution({
            gitStatus: postPushStatus,
            isBusy: false,
            isDefaultBranch: actionIsDefaultBranch,
            hasOriginRemote,
            defaultBranchName,
          }).kind === "run_action";
        const closeResultToast = () => {
          toastManager.close(resolvedProgressToastId);
        };

        toastManager.update(resolvedProgressToastId, {
          type: "success",
          title: resultToast.title,
          description: resultToast.description,
          timeout: 0,
          data: {
            ...threadToastData,
            dismissAfterVisibleMs: 10_000,
          },
          ...(shouldOfferPushCta
            ? {
                actionProps: {
                  children: "Push",
                  onClick: () => {
                    void runGitActionWithToast({
                      action: "push",
                      onConfirmed: closeResultToast,
                      statusOverride: actionStatus,
                      isDefaultBranchOverride: actionIsDefaultBranch,
                    });
                  },
                },
              }
            : shouldOfferOpenPrCta
              ? {
                  actionProps: {
                    children: "View PR",
                    onClick: () => {
                      const api = readNativeApi();
                      if (!api) return;
                      closeResultToast();
                      void api.shell.openExternal(prUrl);
                    },
                  },
                }
              : shouldOfferCreatePrCta
                ? {
                    actionProps: {
                      children: "Create PR",
                      onClick: () => {
                        closeResultToast();
                        openCreatePrDialog({
                          statusOverride: postPushStatus,
                          statusOverrideSource: actionStatus,
                          isDefaultBranchOverride: actionIsDefaultBranch,
                        });
                      },
                    },
                  }
                : {}),
        });
        afterSuccess?.(result);
      } catch (err) {
        toastManager.update(resolvedProgressToastId, {
          type: "error",
          title: failedPhase
            ? `${failedPhase === "pr" ? "Pull request" : failedPhase} failed`
            : `${progress.currentPhaseLabel?.replace(/\.{3}$/, "") ?? "Action"} failed`,
          description: failedMessage ?? (err instanceof Error ? err.message : "An error occurred."),
          timeout: 0,
          data: {
            ...threadToastData,
            copyText: failedMessage ?? (err instanceof Error ? err.message : "An error occurred."),
          },
        });
      } finally {
        unsubscribe?.();
        window.clearInterval(interval);
      }
    },
    [
      defaultBranchName,
      gitStatusForActions,
      hasOriginRemote,
      isDefaultBranch,
      openCreatePrDialog,
      persistThreadPr,
      runAction,
      setPendingDefaultBranchAction,
      threadToastData,
    ],
  );
}
