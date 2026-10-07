import { isElectron } from "~/env";
import { terminalRuntimeEnv } from "~/lib/terminalRuntimeEnv";
import { getRuntimeAwareModelCapabilities } from "../runtimeModelCapabilities";
import { threadExportBlockedReason } from "@glade/shared/threads/threadExport";
import { useLayoutEffect } from "react";
import {
  resolveActiveTurnLiveDiffState,
  resolveGitRepoUiState,
  resolveSettledThreadBranchMismatch,
} from "../../ChatView.logic.worktree";
import { shouldRenderProviderHealthBanner } from "../../ChatView.logic.session";
import { useChatProviderStatus } from "~/components/chat/useChatProviderStatus";
import { stripComposerTriggerText } from "~/composer-logic";
import { canOfferForkSlashCommand, canOfferReviewSlashCommand } from "~/composerSlashCommands";
import { stripDiffSearchParams } from "~/diffRouteSearch";
import { useComposerCommandMenuItems } from "~/hooks/useComposerCommandMenuItems";
import { useRefreshProviderStatusesNow } from "~/hooks/useProviderStatusRefresh";
import { useRepoDiffTotals } from "~/hooks/useRepoDiffTotals";
import { formatShortcutLabel, shortcutLabelForCommand } from "~/keybindings";
import { findProviderStatus } from "~/lib/providerAvailability";
import { resolveAvailableHandoffTargetProviders } from "~/lib/threadHandoff";
import {
  ChatViewProps,
  EMPTY_AVAILABLE_EDITORS,
  EMPTY_KEYBINDINGS,
  EMPTY_TERMINAL_RUNTIME_ENV,
  getProviderHealthBannerDismissalKey,
} from "./chatViewSupport";
import type { useChatProviderController } from "./useChatProviderController";
import type { useChatSessionController } from "./useChatSessionController";
import type { useChatTranscriptController } from "./useChatTranscriptController";
import type { useChatWorkspaceController } from "./useChatWorkspaceController";
export function useChatDiscoveryController({
  transcript,
  workspace,
  session,
  provider,
  props,
}: {
  transcript: ReturnType<typeof useChatTranscriptController>;
  workspace: ReturnType<typeof useChatWorkspaceController>;
  session: ReturnType<typeof useChatSessionController>;
  provider: ReturnType<typeof useChatProviderController>;
  props: ChatViewProps;
}) {
  const {
    gitStatusQuery,
    branchesQuery,
    effectiveComposerTrigger,
    providerPlugins,
    providerNativeCommands,
    providerSkills,
    workspaceEntries,
    canCompactThread,
    providerArtifacts,
    threadWorkspaceCwd,
    turnDiffSummaries,
  } = transcript;
  const {
    activeProject,
    settledThreadBranchWarningDismissedThreadId,
    resolvedThreadWorktreePath,
    settledThreadBranchAtActivation,
    isServerThread,

    isContainerLandingProject,
    repoDiffBadgeRefreshIntervalMs,
    activeLatestTurn,
    diffEnvironmentPending,
    diffOpen,
    terminalState,
    terminalWorkspaceTerminalTabActive,
  } = workspace;
  const {
    activeThread,
    composerTrigger,
    prompt,
    composerImages,
    composerTerminalContexts,
    composerThreadSummaries,
    composerThreadProjects,
    composerCommandPicker,
    isComposerExtrasPanelOpen,
    composerHighlightedItemId,
    composerMenuOpenRef,
    composerMenuItemsRef,
    activeComposerMenuItemRef,
    durablyPersistedComposerImageIds,
    nonPersistedComposerImageIds,
    settings,
    dismissedProviderHealthBannerKeys,
    navigate,
  } = session;
  const {
    selectedProvider,
    selectedModel,
    composerModelOptions,
    selectedComposerSkills,
    selectedComposerMentions,
    searchableModelOptions,
    dynamicAgents,
    serverConfigQuery,
    serverSettingsQuery,
    workLogEntries,
  } = provider;
  const { threadId, onToggleDiffPanel } = props;

  const currentActiveGitBranch = (() => {
    if (gitStatusQuery.data !== undefined) {
      return gitStatusQuery.data.branch;
    }

    return (
      branchesQuery.data?.branches.find(
        (branch) =>
          branch.current === true &&
          (branch.worktreePath === null ||
            branch.worktreePath === undefined ||
            branch.worktreePath === activeProject?.cwd),
      )?.name ?? null
    );
  })();

  const settledThreadBranchMismatch = resolveSettledThreadBranchMismatch({
    isSettled:
      activeThread?.settledAt != null &&
      settledThreadBranchWarningDismissedThreadId !== activeThread.id,
    isLocalWorkspace: resolvedThreadWorktreePath === null,
    threadBranch: settledThreadBranchAtActivation,
    currentBranch: currentActiveGitBranch,
  });

  const selectedModelCaps = getRuntimeAwareModelCapabilities({
    provider: selectedProvider,
    model: selectedModel,
    runtimeModel: provider.selectedRuntimeModel,
  });

  const supportsFastSlashCommand = selectedModelCaps.supportsFastMode;

  const currentProviderModelOptions = composerModelOptions?.[selectedProvider];

  const fastModeEnabled =
    supportsFastSlashCommand &&
    (currentProviderModelOptions as { fastMode?: boolean } | undefined)?.fastMode === true;

  const composerPromptWithoutActiveSlashTrigger =
    composerTrigger?.kind === "slash-command"
      ? stripComposerTriggerText(prompt, composerTrigger)
      : prompt;

  const canOfferReviewCommand =
    (branchesQuery.data?.isRepo ?? true) &&
    canOfferReviewSlashCommand({
      prompt: composerPromptWithoutActiveSlashTrigger,
      imageCount: composerImages.length,
      terminalContextCount: composerTerminalContexts.length,
      selectedSkillCount: selectedComposerSkills.length,
      selectedMentionCount: selectedComposerMentions.length,
    });

  const canOfferForkCommand =
    isServerThread &&
    activeThread !== undefined &&
    canOfferForkSlashCommand({
      prompt: composerPromptWithoutActiveSlashTrigger,
      imageCount: composerImages.length,
      terminalContextCount: composerTerminalContexts.length,
      selectedSkillCount: selectedComposerSkills.length,
      selectedMentionCount: selectedComposerMentions.length,
    });

  const canOfferExportCommand =
    isServerThread &&
    activeThread !== undefined &&
    threadExportBlockedReason(activeThread) === null;

  const normalComposerMenuItems = useComposerCommandMenuItems({
    trigger: { composerTrigger: effectiveComposerTrigger },
    catalog: {
      provider: selectedProvider,
      providerPlugins,
      providerNativeCommands,
      providerSkills,
      searchableModelOptions,
      providerArtifacts,
      dynamicAgents,
    },
    references: {
      workspaceEntries,
      threadMentionSources: {
        threads: composerThreadSummaries,
        projects: composerThreadProjects,
        currentThreadId: threadId,
      },
    },
    commands: {
      supportsFastSlashCommand,
      canOfferCompactCommand:
        canCompactThread &&
        isServerThread &&
        activeThread?.session !== null &&
        activeThread?.session?.status !== "closed",
      canOfferReviewCommand,
      canOfferForkCommand,
      canOfferExportCommand,
      canOfferComputerUseCommand: isElectron,
    },
  });

  const composerMenuItems = (() => {
    if (composerCommandPicker === "fork-target") {
      return [
        {
          id: "fork-target:worktree",
          type: "fork-target" as const,
          target: "worktree" as const,
          label: "Fork Into New Worktree",
          description: "Continue in a new worktree",
        },
        {
          id: "fork-target:local",
          type: "fork-target" as const,
          target: "local" as const,
          label: "Fork Into Local",
          description:
            activeThread?.worktreePath || activeThread?.envMode === "worktree"
              ? "Continue in this local worktree"
              : "Continue in the current local thread",
        },
      ];
    }
    if (composerCommandPicker === "review-target") {
      return [
        {
          id: "review-target:changes",
          type: "review-target" as const,
          target: "changes" as const,
          label: "Review Uncommitted Changes",
          description: "Review local uncommitted changes",
        },
        {
          id: "review-target:base-branch",
          type: "review-target" as const,
          target: "base-branch" as const,
          label: "Review Against Base Branch",
          description: "Review the current branch diff against its base",
        },
      ];
    }

    return normalComposerMenuItems;
  })();

  const composerMenuOpen = Boolean(composerTrigger || composerCommandPicker);

  const composerExtrasPanelOpen = isComposerExtrasPanelOpen && !composerMenuOpen;

  const composerOverlayOpen = composerMenuOpen || composerExtrasPanelOpen;

  const activeComposerMenuItem =
    composerMenuItems.find((item) => item.id === composerHighlightedItemId) ??
    composerMenuItems[0] ??
    null;

  useLayoutEffect(() => {
    composerMenuOpenRef.current = composerMenuOpen;
    composerMenuItemsRef.current = composerMenuItems;
    activeComposerMenuItemRef.current = activeComposerMenuItem;
  }, [
    composerMenuOpenRef,
    composerMenuItemsRef,
    activeComposerMenuItemRef,
    composerMenuOpen,
    composerMenuItems,
    activeComposerMenuItem,
  ]);

  const nonPersistedComposerImageIdSet = (() => {
    const durableBlobIds = new Set(
      durablyPersistedComposerImageIds
        .filter((attachment) => Boolean(attachment.blobKey))
        .map((attachment) => attachment.id),
    );
    return new Set(nonPersistedComposerImageIds.filter((id) => !durableBlobIds.has(id)));
  })();

  const keybindings = serverConfigQuery.data?.keybindings ?? EMPTY_KEYBINDINGS;

  const availableEditors = serverConfigQuery.data?.availableEditors ?? EMPTY_AVAILABLE_EDITORS;

  const { rememberCustomBinaryPathForDispatch, providerStatuses } = useChatProviderStatus({
    activeThread,
    settings,
    configuredProviderStatuses: serverConfigQuery.data?.providers,
  });

  const handoffTargetProviders = activeThread
    ? resolveAvailableHandoffTargetProviders({
        sourceProvider: activeThread.modelSelection.provider,
        providerSettings: serverSettingsQuery.data?.providers,
        providerStatuses,
      })
    : [];

  const activeProviderStatus = findProviderStatus(providerStatuses, selectedProvider);

  const activeProviderHealthBannerDismissalKey =
    getProviderHealthBannerDismissalKey(activeProviderStatus);

  const visibleActiveProviderStatus =
    activeProviderHealthBannerDismissalKey &&
    dismissedProviderHealthBannerKeys.includes(activeProviderHealthBannerDismissalKey)
      ? null
      : activeProviderStatus;

  const voiceProviderStatus = findProviderStatus(providerStatuses, "codex");

  const refreshProviderStatuses = useRefreshProviderStatusesNow();

  const activeProjectCwd = activeProject?.cwd ?? null;

  const activeThreadWorktreePath = activeThread?.worktreePath ?? null;

  const hasNativeUserMessages =
    activeThread?.messages.some(
      (message) =>
        message.role === "user" &&
        (message.source === "native" || message.source === "async-user-input"),
    ) ?? false;

  // Left to React Compiler instead of a manual `useMemo`: the hand-written dep array could not be
  // preserved (the compiler cannot prove `threadWorkspaceCwd` is never mutated), which bailed the
  // whole component out of compilation. The empty case returns a module-level constant so its
  // identity is stable no matter how the value is memoized.
  const terminalRuntimeProjectCwd = activeProjectCwd;

  const threadTerminalRuntimeEnv = terminalRuntimeProjectCwd
    ? terminalRuntimeEnv({
        cwd: terminalRuntimeProjectCwd,
        worktreePath: activeThreadWorktreePath,
      })
    : EMPTY_TERMINAL_RUNTIME_ENV;

  const isGitRepo = resolveGitRepoUiState({ queriedIsRepo: branchesQuery.data?.isRepo });

  const showGitActions = !isContainerLandingProject || Boolean(resolvedThreadWorktreePath);

  const repoDiffTotals = useRepoDiffTotals({
    gitCwd: threadWorkspaceCwd,
    isGitRepo,
    refetchInterval: repoDiffBadgeRefreshIntervalMs,
  });

  const activeTurnLiveDiffState = resolveActiveTurnLiveDiffState({
    latestTurnId: activeLatestTurn?.turnId ?? null,
    turnDiffSummaries,
    workLogEntries,
  });

  const newTerminalShortcutLabel = shortcutLabelForCommand(keybindings, "terminal.new");

  const closeTerminalShortcutLabel = shortcutLabelForCommand(keybindings, "terminal.close");

  const closeWorkspaceShortcutLabel = shortcutLabelForCommand(
    keybindings,
    "terminal.workspace.closeActive",
  );

  const modelPickerShortcutLabel =
    shortcutLabelForCommand(keybindings, "modelPicker.toggle") ??
    formatShortcutLabel({
      key: "m",
      metaKey: false,
      ctrlKey: false,
      shiftKey: true,
      altKey: false,
      modKey: true,
    });

  const onToggleDiff = () => {
    if (diffEnvironmentPending && !diffOpen) {
      return;
    }
    if (onToggleDiffPanel) {
      onToggleDiffPanel();
      return;
    }
    void navigate({
      to: "/$threadId",
      params: { threadId },
      replace: true,
      search: (previous) => {
        const rest = stripDiffSearchParams(previous);
        return diffOpen
          ? { ...rest, panel: undefined, diff: undefined }
          : { ...rest, panel: "diff", diff: "1" };
      },
    });
  };

  const envLocked = Boolean(
    activeThread &&
    (activeThread.messages.length > 0 ||
      (activeThread.session !== null && activeThread.session.status !== "closed")),
  );

  const isTerminalPrimarySurface = terminalState.entryPoint === "terminal";

  const isTerminalEnvironmentContext =
    isTerminalPrimarySurface || terminalWorkspaceTerminalTabActive;

  const shouldShowProviderHealthBanner =
    shouldRenderProviderHealthBanner({
      threadEntryPoint: terminalState.entryPoint,
      terminalWorkspaceTerminalTabActive,
    }) && hasNativeUserMessages;

  const shouldRenderChatPaneContent = !(
    terminalWorkspaceTerminalTabActive && terminalState.workspaceLayout === "terminal-only"
  );

  const secondaryChromeThreadId = activeThread?.id ?? threadId;

  return {
    currentActiveGitBranch,
    settledThreadBranchMismatch,
    supportsFastSlashCommand,
    currentProviderModelOptions,
    fastModeEnabled,
    canOfferExportCommand,
    composerMenuItems,
    composerMenuOpen,
    composerExtrasPanelOpen,
    composerOverlayOpen,
    activeComposerMenuItem,
    nonPersistedComposerImageIdSet,
    keybindings,
    availableEditors,
    rememberCustomBinaryPathForDispatch,
    providerStatuses,
    handoffTargetProviders,
    activeProviderStatus,
    activeProviderHealthBannerDismissalKey,
    visibleActiveProviderStatus,
    voiceProviderStatus,
    refreshProviderStatuses,
    hasNativeUserMessages,
    threadTerminalRuntimeEnv,
    isGitRepo,
    showGitActions,
    repoDiffTotals,
    activeTurnLiveDiffState,
    newTerminalShortcutLabel,
    closeTerminalShortcutLabel,
    closeWorkspaceShortcutLabel,
    modelPickerShortcutLabel,
    onToggleDiff,
    envLocked,
    isTerminalPrimarySurface,
    isTerminalEnvironmentContext,
    shouldShowProviderHealthBanner,
    shouldRenderChatPaneContent,
    secondaryChromeThreadId,
  } as const;
}
