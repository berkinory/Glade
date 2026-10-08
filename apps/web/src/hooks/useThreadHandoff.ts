import { useActiveEnvironment } from "~/environments/activeEnvironment";
import { toastManager } from "../components/ui/toast";
import { resolveProviderModelSelection } from "~/lib/providerModelSelection";
import { useQuery } from "@tanstack/react-query";
import { type ModelSelection } from "@glade/contracts/provider/sessionPolicy";
import { type ProviderKind } from "@glade/contracts/core/baseSchemas";
import { useComposerDraftStore } from "../composerDraftStore";
import { useProviderStatusesForLocalConfig } from "./useProviderStatusesForLocalConfig";
import { useRefreshProviderStatusesNow } from "./useProviderStatusRefresh";
import {
  canCreateThreadHandoff,
  isEligibleHandoffTargetProvider,
  resolveThreadHandoffModelSelection,
} from "../lib/threadHandoff";
import { resolveProviderSendAvailabilityWithRefresh } from "../lib/providerAvailability";
import { serverSettingsQueryOptions } from "../lib/serverReactQuery";
import { newCommandId } from "../lib/utils";
import { readNativeApi } from "../nativeApi";
import { useStore } from "../store";
import { type Thread } from "../types";

export function useThreadHandoff() {
  const projects = useStore((store) => store.projects);
  const syncServerShellSnapshot = useStore((store) => store.syncServerShellSnapshot);
  const providerStatuses = useProviderStatusesForLocalConfig(useActiveEnvironment());
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

    const createdAt = new Date().toISOString();
    const { stickyModelSelectionByProvider } = useComposerDraftStore.getState();
    await api.orchestration.dispatchCommand({
      type: "thread.handoff.start",
      commandId: newCommandId(),
      threadId: thread.id,
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

      ...(continuationGoal ? { continuationGoal } : {}),
      createdAt,
    });

    void api.orchestration
      .getShellSnapshot()
      .then(syncServerShellSnapshot)
      .catch((cause: unknown) => {
        toastManager.add({
          type: "error",
          title: "Could not refresh chat list",
          description: cause instanceof Error ? cause.message : "Try refreshing the chat list.",
        });
      });
    void api.orchestration.prepareHandoff({ threadId: thread.id }).catch((cause: unknown) => {
      toastManager.add({
        type: "error",
        title: "Handoff context needs preparation",
        description:
          cause instanceof Error
            ? cause.message
            : "Retry preparation in this chat. The source and draft are intact.",
      });
    });
    return thread.id;
  };

  return {
    createThreadHandoff,
  };
}
