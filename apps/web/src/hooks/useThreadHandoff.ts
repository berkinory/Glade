import { toastManager } from "../components/ui/toast";
import { resolveProviderModelSelection } from "~/lib/providerModelSelection";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { type ModelSelection } from "@glade/contracts/provider/sessionPolicy";
import { type ProviderKind } from "@glade/contracts/core/baseSchemas";
import { useComposerDraftStore } from "../composerDraftStore";
import { useProviderStatusesForLocalConfig } from "./useProviderStatusesForLocalConfig";
import { useRefreshProviderStatusesNow } from "./useProviderStatusRefresh";
import {
  canCreateThreadHandoff,
  isEligibleHandoffTargetProvider,
  resolveThreadHandoffModelSelection,
  resolveThreadHandoffTitle,
} from "../lib/threadHandoff";
import { resolveProviderSendAvailabilityWithRefresh } from "../lib/providerAvailability";
import { serverSettingsQueryOptions } from "../lib/serverReactQuery";
import { newCommandId, newThreadId } from "../lib/utils";
import { readNativeApi } from "../nativeApi";
import { useStore } from "../store";
import { type Thread } from "../types";

export function useThreadHandoff() {
  const navigate = useNavigate();
  const projects = useStore((store) => store.projects);
  const syncServerShellSnapshot = useStore((store) => store.syncServerShellSnapshot);
  const providerStatuses = useProviderStatusesForLocalConfig();
  const refreshProviderStatuses = useRefreshProviderStatusesNow();
  const serverSettingsQuery = useQuery(serverSettingsQueryOptions());

  const createThreadHandoff = async (
    thread: Thread,
    targetProvider: ProviderKind,
    selectedModel?: ModelSelection,
    selectedRuntimeMode?: Thread["runtimeMode"],
    continuationGoal?: string,
  ): Promise<Thread["id"]> => {
    const api = readNativeApi();
    if (!api) {
      throw new Error("Native API not found");
    }

    const project = projects.find((entry) => entry.id === thread.projectId);
    if (!project) {
      throw new Error("Project not found for handoff thread.");
    }

    if (!canCreateThreadHandoff({ thread })) {
      throw new Error("This thread cannot be handed off yet.");
    }
    const targetAvailability = await resolveProviderSendAvailabilityWithRefresh({
      provider: targetProvider,
      statuses: providerStatuses,
      refreshStatuses: () => refreshProviderStatuses({ silent: true }),
    });
    if (
      !isEligibleHandoffTargetProvider({
        sourceProvider: thread.modelSelection.provider,
        targetProvider,
        targetProviderEnabled: serverSettingsQuery.data?.providers[targetProvider].enabled,
        targetProviderStatus: targetAvailability.status,
      })
    ) {
      throw new Error(
        targetAvailability.usable
          ? "This handoff target is not available for the current thread."
          : targetAvailability.unavailableReason,
      );
    }

    const nextThreadId = newThreadId();
    const createdAt = new Date().toISOString();
    const { copyTransferableComposerState, stickyModelSelectionByProvider } =
      useComposerDraftStore.getState();

    await api.orchestration.dispatchCommand({
      type: "thread.handoff.create",
      commandId: newCommandId(),
      threadId: nextThreadId,
      sourceThreadId: thread.id,
      projectId: thread.projectId,
      title: resolveThreadHandoffTitle(thread),
      modelSelection: await resolveProviderModelSelection({
        api,
        cwd: project.cwd,
        selection:
          selectedModel ??
          resolveThreadHandoffModelSelection({
            sourceThread: thread,
            targetProvider,
            projectDefaultModelSelection: project.defaultModelSelection,
            stickyModelSelectionByProvider,
          }),
      }),
      runtimeMode: selectedRuntimeMode ?? thread.runtimeMode,

      envMode: thread.envMode ?? (thread.worktreePath ? "worktree" : "local"),
      branch: thread.branch,
      worktreePath: thread.worktreePath,
      workingDirectory: thread.workingDirectory ?? null,
      associatedWorktreePath: thread.associatedWorktreePath ?? thread.worktreePath ?? null,
      associatedWorktreeBranch: thread.associatedWorktreeBranch ?? thread.branch ?? null,
      associatedWorktreeRef:
        thread.associatedWorktreeRef ?? thread.associatedWorktreeBranch ?? thread.branch ?? null,
      createBranchFlowCompleted: thread.createBranchFlowCompleted ?? false,
      importedMessages: [],
      ...(continuationGoal ? { continuationGoal } : {}),
      createdAt,
    });

    copyTransferableComposerState(thread.id, nextThreadId);

    const snapshot = await api.orchestration.getShellSnapshot();
    syncServerShellSnapshot(snapshot);
    await navigate({
      to: "/$threadId",
      params: { threadId: nextThreadId },
    });

    try {
      await api.orchestration.prepareHandoff({ threadId: nextThreadId });
    } catch (cause) {
      toastManager.add({
        type: "error",
        title: "Handoff context needs preparation",
        description:
          cause instanceof Error
            ? cause.message
            : "Retry preparation in the new chat. The source and draft are intact.",
      });
    }
    return nextThreadId;
  };

  return {
    createThreadHandoff,
  };
}
