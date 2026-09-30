import { ThreadId, type TurnId } from "@glade/contracts/core/baseSchemas";
import { type ProjectScript } from "@glade/contracts/orchestration/threadEntities";
import { useCallback, useEffect, useRef, useState } from "react";
import { ExpandedImagePreview } from "~/components/chat/ExpandedImagePreview";
import { COMPUTER_CONTROL_HINT_EFFORT } from "~/components/chat/composerComputerControlHint";
import { useThreadErrorToast } from "~/components/chat/useThreadErrorToast";
import {
  selectThreadComputerPreviewLayout,
  selectThreadComputerPreviewSession,
  useComputerStateStore,
} from "~/computerStateStore";
import { stripDiffSearchParams } from "~/diffRouteSearch";
import { buildNextProviderOptions } from "~/providerModelOptions";
import { ChatViewProps, MAX_DISMISSED_PROVIDER_HEALTH_BANNERS } from "./chatViewSupport";
import type { useChatComposerController } from "./useChatComposerController";
import type { useChatDiscoveryController } from "./useChatDiscoveryController";
import type { useChatEnvironmentController } from "./useChatEnvironmentController";
import type { useChatProviderController } from "./useChatProviderController";
import type { useChatSessionController } from "./useChatSessionController";
import type { useChatSubmissionController } from "./useChatSubmissionController";
import type { useChatWorkspaceController } from "./useChatWorkspaceController";
export function useChatSurfaceController({
  session,
  workspace,
  props,
  discovery,
  environment,
  composer,
  submission,
  provider,
}: {
  session: ReturnType<typeof useChatSessionController>;
  workspace: ReturnType<typeof useChatWorkspaceController>;
  props: ChatViewProps;
  discovery: ReturnType<typeof useChatDiscoveryController>;
  environment: ReturnType<typeof useChatEnvironmentController>;
  composer: ReturnType<typeof useChatComposerController>;
  submission: ReturnType<typeof useChatSubmissionController>;
  provider: ReturnType<typeof useChatProviderController>;
}) {
  const {
    setExpandedImage,
    navigate,
    activeThread,
    setDismissedProviderHealthBannerKeys,
    setDismissedRateLimitBannerKey,
    setComposerDraftProviderModelOptions,
    updateSettings,
  } = session;
  const { diffEnvironmentPending, activeRateLimitBannerDismissalKey } = workspace;
  const { onOpenTurnDiffPanel, threadId } = props;
  const { activeTurnLiveDiffState, activeProviderHealthBannerDismissalKey } = discovery;
  const { runProjectScript } = environment;
  const { setThreadError, scheduleComposerFocus } = composer;
  const { composerTraitSelection, selectedProviderModelOptions } = submission;
  const { selectedProvider, selectedModelForPickerWithCustomFallback } = provider;

  const onExpandTimelineImage = useCallback(
    (preview: ExpandedImagePreview) => {
      setExpandedImage(preview);
    },
    [setExpandedImage],
  );

  const onOpenTurnDiff = useCallback(
    (turnId: TurnId, filePath?: string) => {
      if (diffEnvironmentPending) {
        return;
      }
      if (onOpenTurnDiffPanel) {
        onOpenTurnDiffPanel(turnId, filePath);
        return;
      }
      void navigate({
        to: "/$threadId",
        params: { threadId },
        search: (previous) => {
          const rest = stripDiffSearchParams(previous);
          return filePath
            ? {
                ...rest,
                panel: "diff",
                diff: "1",
                diffTurnId: turnId,
                diffFilePath: filePath,
              }
            : { ...rest, panel: "diff", diff: "1", diffTurnId: turnId };
        },
      });
    },
    [diffEnvironmentPending, navigate, onOpenTurnDiffPanel, threadId],
  );

  const onReviewComposerLiveChanges = useCallback(() => {
    if (!activeTurnLiveDiffState.turnId) {
      return;
    }
    onOpenTurnDiff(activeTurnLiveDiffState.turnId);
  }, [activeTurnLiveDiffState.turnId, onOpenTurnDiff]);

  const onNavigateToThread = useCallback(
    (nextThreadId: ThreadId) => {
      void navigate({
        to: "/$threadId",
        params: { threadId: nextThreadId },
        search: (previous) => stripDiffSearchParams(previous),
      });
    },
    [navigate],
  );

  const onOpenAutomation = useCallback(
    (automationId: string) => {
      void navigate({
        to: "/automations/$automationId",
        params: { automationId },
      });
    },
    [navigate],
  );

  const onRunProjectScriptFromHeader = useCallback(
    (script: ProjectScript) => {
      void runProjectScript(script);
    },
    [runProjectScript],
  );

  const dismissActiveThreadError = useCallback(() => {
    if (!activeThread) return;
    setThreadError(activeThread.id, null);
  }, [activeThread, setThreadError]);

  useThreadErrorToast({
    threadId: activeThread?.id ?? null,
    error: activeThread?.error ?? null,
    onDismiss: dismissActiveThreadError,
  });

  const dismissActiveProviderHealthBanner = useCallback(() => {
    if (!activeProviderHealthBannerDismissalKey) return;
    setDismissedProviderHealthBannerKeys((current) => {
      if (current.includes(activeProviderHealthBannerDismissalKey)) {
        return current;
      }
      return [activeProviderHealthBannerDismissalKey, ...current].slice(
        0,
        MAX_DISMISSED_PROVIDER_HEALTH_BANNERS,
      );
    });
  }, [activeProviderHealthBannerDismissalKey, setDismissedProviderHealthBannerKeys]);

  const dismissActiveRateLimitBanner = useCallback(() => {
    if (!activeRateLimitBannerDismissalKey) return;
    setDismissedRateLimitBannerKey(activeRateLimitBannerDismissalKey);
  }, [setDismissedRateLimitBannerKey, activeRateLimitBannerDismissalKey]);

  const previewSession = useComputerStateStore(selectThreadComputerPreviewSession(threadId));

  const previewLayout = useComputerStateStore(selectThreadComputerPreviewLayout(threadId));

  const mainContentRef = useRef<HTMLDivElement | null>(null);

  const [mainContentWidth, setMainContentWidth] = useState(1600);

  useEffect(() => {
    const element = mainContentRef.current;
    if (!element) return;
    const update = () => {
      const width = element.clientWidth;
      setMainContentWidth((previous) => (previous === width ? previous : width));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const composerEffortOptionId = composerTraitSelection.primarySelectDescriptor?.id ?? "effort";

  const applyComputerControlEffortHint = useCallback(() => {
    setComposerDraftProviderModelOptions(
      threadId,
      selectedProvider,
      buildNextProviderOptions(selectedProvider, selectedProviderModelOptions, {
        [composerEffortOptionId]: COMPUTER_CONTROL_HINT_EFFORT,
      }),
      { model: selectedModelForPickerWithCustomFallback, persistSticky: true },
    );
    updateSettings({ dismissedComputerControlEffortHint: true });
    scheduleComposerFocus();
  }, [
    composerEffortOptionId,
    scheduleComposerFocus,
    selectedModelForPickerWithCustomFallback,
    selectedProvider,
    selectedProviderModelOptions,
    setComposerDraftProviderModelOptions,
    threadId,
    updateSettings,
  ]);

  const dismissComputerControlEffortHint = useCallback(() => {
    updateSettings({ dismissedComputerControlEffortHint: true });
    scheduleComposerFocus();
  }, [scheduleComposerFocus, updateSettings]);
  return {
    onExpandTimelineImage,
    onOpenTurnDiff,
    onReviewComposerLiveChanges,
    onNavigateToThread,
    onOpenAutomation,
    onRunProjectScriptFromHeader,
    dismissActiveProviderHealthBanner,
    dismissActiveRateLimitBanner,
    previewSession,
    previewLayout,
    mainContentRef,
    mainContentWidth,
    applyComputerControlEffortHint,
    dismissComputerControlEffortHint,
  } as const;
}
