import { ProviderKind, ThreadId } from "@glade/contracts/core/baseSchemas";
import { type ModelSelection } from "@glade/contracts/provider/sessionPolicy";
import { type LegendListRef } from "@legendapp/list/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Schema } from "effect";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { resolveAssistantDeliveryMode, useAppSettings } from "~/appSettings";
import {
  DISMISSED_PROVIDER_HEALTH_BANNERS_KEY,
  DismissedProviderHealthBannersSchema,
  type PendingFileUndo,
} from "../../ChatView.logic.session";
import {
  type PullRequestDialogState,
  buildLocalDraftThread,
  resolveDraftFallbackModelSelection,
} from "../../ChatView.logic.worktree";
import { ComposerCommandItem } from "~/components/chat/ComposerCommandMenu";
import { type ComposerLocalDirectoryMenuHandle } from "~/components/chat/ComposerLocalDirectoryMenu";
import { ExpandedImagePreview } from "~/components/chat/ExpandedImagePreview";
import type { MessagesTimelineController } from "~/components/chat/timeline/timelineSupport";
import {
  composerTranscriptBottomInsetPx,
  useComposerOverlayHeight,
} from "~/components/chat/composerOverlay";
import {
  createThreadFindHighlightStore,
  type ThreadFindMatch,
} from "~/components/chat/threadFind.logic";
import { useChatComposerDraft } from "~/components/chat/useChatComposerDraft";
import { useComposerDraftStore } from "~/composerDraftStore";
import {
  useDesktopTopBarTrafficLightGutterClassName,
  useDesktopTopBarWindowControlsGutterClassName,
} from "~/hooks/useDesktopTopBarGutter";
import { useDiffRouteSearch } from "~/hooks/useDiffRouteSearch";
import { useHandleNewThread } from "~/hooks/useHandleNewThread";
import { useLocalStorage } from "~/hooks/useLocalStorage";
import { useTheme } from "~/hooks/useTheme";
import { useThreadHandoff } from "~/hooks/useThreadHandoff";
import { SINGLE_CHAT_PANE_SCOPE_ID } from "~/lib/chatPaneScope";
import { gitCreateDetachedWorktreeMutationOptions } from "~/lib/gitReactQuery";
import { useStore } from "~/store";
import {
  createComposerThreadMentionSourcesSelector,
  createProjectSelector,
  createThreadSelector,
} from "~/storeSelectors";
import type { ComposerThreadMentionSource } from "~/types";
import { useWorkflowRunUiStore } from "~/workflowRunUiStore";
import { ChatViewProps, EMPTY_DISMISSED_PROVIDER_HEALTH_BANNERS } from "./chatViewSupport";

const EMPTY_THREAD_MENTION_SOURCES: readonly ComposerThreadMentionSource[] = [];

export function useChatSessionController(props: ChatViewProps) {
  const {
    threadId,
    hideHeader: hideHeaderProp,
    paneScopeId: paneScopeIdProp,
    surfaceMode: surfaceModeProp,
    isFocusedPane: isFocusedPaneProp,
  } = props;

  const paneScopeId = paneScopeIdProp ?? SINGLE_CHAT_PANE_SCOPE_ID;

  const hideHeader = hideHeaderProp ?? false;

  const surfaceMode = surfaceModeProp ?? "single";

  const isFocusedPane = isFocusedPaneProp ?? true;

  const markThreadVisited = useStore((store) => store.markThreadVisited);

  const syncServerShellSnapshot = useStore((store) => store.syncServerShellSnapshot);

  const setStoreThreadError = useStore((store) => store.setError);

  const setStoreThreadWorkspace = useStore((store) => store.setThreadWorkspace);

  const { settings, updateSettings } = useAppSettings();

  const assistantDeliveryMode = resolveAssistantDeliveryMode(settings);

  const desktopTopBarTrafficLightGutterClassName = useDesktopTopBarTrafficLightGutterClassName();

  const desktopTopBarWindowControlsGutterClassName =
    useDesktopTopBarWindowControlsGutterClassName();

  const setComposerDraftModelSelectionAndSticky = useComposerDraftStore(
    (store) => store.setModelSelectionAndSticky,
  );

  const timestampFormat = settings.timestampFormat;

  const {
    overlayRef: composerOverlayRef,
    overlayHeightPx: composerOverlayHeightPx,
    overlayBottomClearancePx: composerOverlayBottomClearancePx,
  } = useComposerOverlayHeight();

  const composerTranscriptInsetPx = composerTranscriptBottomInsetPx(composerOverlayHeightPx);

  const navigate = useNavigate();

  const { handleNewThread } = useHandleNewThread();

  const { createThreadHandoff } = useThreadHandoff();

  const rawSearch = useDiffRouteSearch();

  const { resolvedTheme } = useTheme();

  const queryClient = useQueryClient();

  const createWorktreeMutation = useMutation(
    gitCreateDetachedWorktreeMutationOptions({ queryClient }),
  );

  const isInactiveSplitPane = surfaceMode === "split" && !isFocusedPane;

  const {
    composerDraft,
    prompt,
    composerImages,
    composerFiles,
    composerAssistantSelections,
    composerFileComments,
    composerTerminalContexts,
    composerPastedTexts,
    composerPullRequestContexts,
    composerSkills,
    composerMentions,
    queuedComposerTurns,
    composerSendState,
    nonPersistedComposerImageIds,
    durablyPersistedComposerImageIds,
    setComposerDraftPrompt,
    setComposerDraftPromptHistorySavedDraft,
    restoreComposerDraftPromptHistorySavedDraft,
    setComposerDraftModelSelection,
    setComposerDraftProviderModelOptions,
    setComposerDraftRuntimeMode,

    enqueueQueuedComposerTurn,
    insertQueuedComposerTurn,
    removeQueuedComposerTurnFromDraft,
    removeComposerDraftFile,
    insertComposerDraftTerminalContext,
    addComposerDraftPastedTexts,
    setComposerDraftTerminalContexts,
    clearComposerDraftContent,
    setDraftThreadContext,
    getDraftThreadByProjectId,
    getDraftThread,
    setProjectDraftThreadId,
    clearProjectDraftThreadId,
    promptRef,
    composerAssistantSelectionsRef,
    composerTerminalContextsRef,
    composerFileCommentsRef,
    composerPastedTextsRef,
    composerPullRequestContextsRef,
    composerCursor,
    setComposerCursor,
    composerTrigger,
    setComposerTrigger,
    composerEditorRef,
    promptHistoryNavigationRef,
    applyingPromptHistoryNavigationRef,
    expectedPromptHistoryPromptRef,
    promptHistoryAppliedPromptRef,
    composerImagesRef,
    composerFilesRef,

    setPrompt,
    discardPromptHistoryNavigationForComposerMutation,
    addComposerImagesToDraft,
    addComposerFilesToDraft,
    addComposerAssistantSelectionToDraft,
    addComposerTerminalContextsToDraft,
    addComposerPastedTextsToDraft,
    addComposerFileCommentToDraft,
    removeComposerImageFromDraft,
    clearComposerAssistantSelectionsFromDraft,
    clearComposerFileCommentsFromDraft,
    removeComposerTerminalContextFromDraft,
    removeComposerPastedTextFromDraft,
    addComposerPullRequestContextsToDraft,
    removeComposerPullRequestContextFromDraft,
    showComposerPastedTextInField,
  } = useChatComposerDraft({ threadId });

  const draftThread = useComposerDraftStore(
    (store) => store.draftThreadsByThreadId[threadId] ?? null,
  );

  const markWorkflowRunPaused = useWorkflowRunUiStore((store) => store.markPaused);

  const markWorkflowRunDismissed = useWorkflowRunUiStore((store) => store.markDismissed);

  const serverThread = useStore(useMemo(() => createThreadSelector(threadId), [threadId]));

  const threadDetailSyncState = useStore((state) =>
    threadId ? (state.threadDetailSyncById?.[threadId] ?? null) : null,
  );

  const threadMentionsOpen = composerTrigger?.kind === "mention";
  const composerThreadSummaries = useStore(
    useMemo(
      () =>
        threadMentionsOpen
          ? createComposerThreadMentionSourcesSelector()
          : () => EMPTY_THREAD_MENTION_SOURCES,
      [threadMentionsOpen],
    ),
  );

  const composerThreadProjects = useStore((state) => state.projects);

  const crossTaskSourceThreadId =
    serverThread?.creationSource && serverThread.sourceThreadId
      ? serverThread.sourceThreadId
      : null;

  const crossTaskSourceThread = useStore(
    useMemo(() => createThreadSelector(crossTaskSourceThreadId), [crossTaskSourceThreadId]),
  );

  const crossTaskOrigin = useMemo(
    () =>
      crossTaskSourceThreadId
        ? {
            sourceThreadId: crossTaskSourceThreadId,
            sourceProvider: crossTaskSourceThread?.modelSelection.provider ?? null,
          }
        : null,
    [crossTaskSourceThread?.modelSelection.provider, crossTaskSourceThreadId],
  );

  const forkSourceThreadId = serverThread?.forkSourceThreadId ?? null;

  const forkSourceThread = useStore(
    useMemo(() => createThreadSelector(forkSourceThreadId), [forkSourceThreadId]),
  );

  const forkSource = useMemo(
    () =>
      forkSourceThreadId
        ? {
            sourceThreadId: forkSourceThreadId,
            sourceTitle: forkSourceThread?.title ?? "chat",
          }
        : null,
    [forkSourceThread?.title, forkSourceThreadId],
  );

  const handoffSourceThreadId = serverThread?.handoff?.operationId
    ? null
    : (serverThread?.handoff?.sourceThreadId ?? null);

  const handoffSourceThread = useStore(
    useMemo(() => createThreadSelector(handoffSourceThreadId), [handoffSourceThreadId]),
  );

  const handoffSource = useMemo(
    () =>
      handoffSourceThreadId && serverThread?.handoff
        ? {
            sourceThreadId: handoffSourceThreadId,
            sourceTitle: handoffSourceThread?.title ?? "chat",
            handoff: {
              sourceProvider: Schema.is(ProviderKind)(serverThread.handoff.sourceProvider)
                ? serverThread.handoff.sourceProvider
                : null,
              targetProvider: serverThread.modelSelection.provider,
            },
          }
        : null,
    [
      handoffSourceThread?.title,
      handoffSourceThreadId,
      serverThread?.handoff,
      serverThread?.modelSelection.provider,
    ],
  );

  const fallbackDraftProjectId = draftThread?.projectId ?? null;

  const fallbackDraftProject = useStore(
    useMemo(() => createProjectSelector(fallbackDraftProjectId), [fallbackDraftProjectId]),
  );

  const draftFallbackModelSelection = useMemo<ModelSelection>(
    () =>
      resolveDraftFallbackModelSelection({
        projectDefault: fallbackDraftProject?.defaultModelSelection,
        settingsDefaultProvider: settings.defaultProvider,
      }),
    [fallbackDraftProject?.defaultModelSelection, settings.defaultProvider],
  );

  const [isDragOverComposer, setIsDragOverComposer] = useState(false);

  const [expandedImage, setExpandedImage] = useState<ExpandedImagePreview | null>(null);

  const [localDraftErrorsByThreadId, setLocalDraftErrorsByThreadId] = useState<
    Record<ThreadId, string | null>
  >({});

  const [isRevertingCheckpoint, setIsRevertingCheckpoint] = useState(false);

  const [pendingFileUndo, setPendingFileUndo] = useState<PendingFileUndo | null>(null);

  const [taskListSidebarOpen, setTaskListSidebarOpen] = useState(false);

  const [activeTaskListCompact, setActiveTaskListCompact] = useState(false);

  const [subagentStripCompact, setSubagentStripCompact] = useState(false);

  const [workflowRunCardCompact, setWorkflowRunCardCompact] = useState(false);

  const [isComposerFooterCompact, setIsComposerFooterCompact] = useState(false);

  // Inputs live in a ref so the resize observer can re-plan without re-subscribing; the sync function
  // is exposed via ref so label changes can re-plan without a resize.
  const [composerFooterTier, setComposerFooterTier] = useState(0);

  const composerFooterTierRef = useRef(0);

  const composerFooterDemotionWidthsRef = useRef<ReadonlyArray<number | undefined>>([]);

  const composerFooterLayoutSyncRef = useRef<(() => void) | null>(null);

  const [composerCommandPicker, setComposerCommandPicker] = useState<
    null | "fork-target" | "review-target"
  >(null);

  const [isComposerExtrasPanelOpen, setIsComposerExtrasPanelOpen] = useState(false);

  const [composerHighlightedItemId, setComposerHighlightedItemId] = useState<string | null>(null);

  const [pullRequestDialogState, setPullRequestDialogState] =
    useState<PullRequestDialogState | null>(null);

  const [dismissedProviderHealthBannerKeys, setDismissedProviderHealthBannerKeys] = useLocalStorage(
    DISMISSED_PROVIDER_HEALTH_BANNERS_KEY,
    EMPTY_DISMISSED_PROVIDER_HEALTH_BANNERS,
    DismissedProviderHealthBannersSchema,
  );

  const [dismissedRateLimitBannerKey, setDismissedRateLimitBannerKey] = useState<string | null>(
    null,
  );

  const [isModelPickerOpen, setIsModelPickerOpen] = useState(false);

  const [isTraitsPickerOpen, setIsTraitsPickerOpen] = useState(false);

  const isComposerModelEffortPickerOpen = isModelPickerOpen || isTraitsPickerOpen;

  const legendListRef = useRef<LegendListRef | null>(null);

  const timelineControllerRef = useRef<MessagesTimelineController | null>(null);

  const [threadFindOpen, setThreadFindOpen] = useState(false);

  const [threadFindFocusNonce, setThreadFindFocusNonce] = useState(0);

  const [threadFindHighlightStore] = useState(() => createThreadFindHighlightStore());

  const handleThreadFindJump = (match: ThreadFindMatch) => {
    timelineControllerRef.current?.scrollToMessage(match.messageId, {
      ...(match.segmentIndex === undefined ? {} : { segmentIndex: match.segmentIndex }),
      fineScrollFind: true,
    });
  };

  const handleThreadFindActiveMatchChange = (match: ThreadFindMatch | null) => {
    threadFindHighlightStore.setActiveMatch(match);
    timelineControllerRef.current?.setActiveFindMatch(match);
  };

  useEffect(() => {
    const settle = window.setTimeout(() => {
      setComposerCommandPicker(null);
      setIsComposerExtrasPanelOpen(false);
      setIsModelPickerOpen(false);
      setIsTraitsPickerOpen(false);
      setThreadFindOpen(false);
      threadFindHighlightStore.set(null);
    }, 0);
    return () => window.clearTimeout(settle);
  }, [
    setComposerCommandPicker,
    setIsComposerExtrasPanelOpen,
    setIsModelPickerOpen,
    setIsTraitsPickerOpen,
    setThreadFindOpen,
    threadId,
    threadFindHighlightStore,
  ]);

  const composerFormRef = useRef<HTMLFormElement>(null);

  const commitAndPushTriggerRef = useRef<(() => void) | null>(null);

  const onRegisterCommitAndPushTrigger = useCallback(
    (trigger: (() => void) | null) => {
      commitAndPushTriggerRef.current = trigger;
    },
    [commitAndPushTriggerRef],
  );

  const pendingComposerFocusRef = useRef(false);

  const composerSelectLockRef = useRef(false);

  const composerMenuOpenRef = useRef(false);

  const composerMenuItemsRef = useRef<ComposerCommandItem[]>([]);

  const activeComposerMenuItemRef = useRef<ComposerCommandItem | null>(null);

  const localDirectoryMenuRef = useRef<ComposerLocalDirectoryMenuHandle | null>(null);

  const sendInFlightRef = useRef(false);

  const sendPreflightInFlightRef = useRef(false);

  const dragDepthRef = useRef(0);

  const terminalOpenByThreadRef = useRef<Record<string, boolean>>({});

  const activatedThreadIdRef = useRef<ThreadId | null>(null);

  const localDraftError = serverThread ? null : (localDraftErrorsByThreadId[threadId] ?? null);

  const localDraftThread = useMemo(
    () =>
      draftThread
        ? buildLocalDraftThread(threadId, draftThread, draftFallbackModelSelection, localDraftError)
        : undefined,
    [draftThread, draftFallbackModelSelection, localDraftError, threadId],
  );

  const activeThread = serverThread ?? localDraftThread;

  return {
    taskListSidebarOpen,
    setTaskListSidebarOpen,
    paneScopeId,
    hideHeader,
    surfaceMode,
    isFocusedPane,
    markThreadVisited,
    syncServerShellSnapshot,
    setStoreThreadError,
    setStoreThreadWorkspace,
    settings,
    updateSettings,
    assistantDeliveryMode,
    desktopTopBarTrafficLightGutterClassName,
    desktopTopBarWindowControlsGutterClassName,
    setComposerDraftModelSelectionAndSticky,
    timestampFormat,
    composerOverlayRef,
    composerOverlayBottomClearancePx,
    composerTranscriptInsetPx,
    navigate,
    handleNewThread,
    createThreadHandoff,
    rawSearch,
    resolvedTheme,
    queryClient,
    createWorktreeMutation,
    isInactiveSplitPane,
    composerDraft,
    prompt,
    composerImages,
    composerFiles,
    composerAssistantSelections,
    composerFileComments,
    composerTerminalContexts,
    composerPastedTexts,
    composerPullRequestContexts,
    composerSkills,
    composerMentions,
    queuedComposerTurns,
    composerSendState,
    nonPersistedComposerImageIds,
    durablyPersistedComposerImageIds,
    setComposerDraftPrompt,
    setComposerDraftPromptHistorySavedDraft,
    restoreComposerDraftPromptHistorySavedDraft,
    setComposerDraftModelSelection,
    setComposerDraftProviderModelOptions,
    setComposerDraftRuntimeMode,

    enqueueQueuedComposerTurn,
    insertQueuedComposerTurn,
    removeQueuedComposerTurnFromDraft,
    removeComposerDraftFile,
    insertComposerDraftTerminalContext,
    addComposerDraftPastedTexts,
    setComposerDraftTerminalContexts,
    clearComposerDraftContent,
    setDraftThreadContext,
    getDraftThreadByProjectId,
    getDraftThread,
    setProjectDraftThreadId,
    clearProjectDraftThreadId,
    promptRef,
    composerAssistantSelectionsRef,
    composerTerminalContextsRef,
    composerFileCommentsRef,
    composerPastedTextsRef,
    composerPullRequestContextsRef,
    composerCursor,
    setComposerCursor,
    composerTrigger,
    setComposerTrigger,
    composerEditorRef,
    promptHistoryNavigationRef,
    applyingPromptHistoryNavigationRef,
    expectedPromptHistoryPromptRef,
    promptHistoryAppliedPromptRef,
    composerImagesRef,
    composerFilesRef,

    setPrompt,
    discardPromptHistoryNavigationForComposerMutation,
    addComposerImagesToDraft,
    addComposerFilesToDraft,
    addComposerAssistantSelectionToDraft,
    addComposerTerminalContextsToDraft,
    addComposerPastedTextsToDraft,
    addComposerFileCommentToDraft,
    removeComposerImageFromDraft,
    clearComposerAssistantSelectionsFromDraft,
    clearComposerFileCommentsFromDraft,
    removeComposerTerminalContextFromDraft,
    removeComposerPastedTextFromDraft,
    addComposerPullRequestContextsToDraft,
    removeComposerPullRequestContextFromDraft,
    showComposerPastedTextInField,
    draftThread,
    markWorkflowRunPaused,
    markWorkflowRunDismissed,
    serverThread,
    threadDetailSyncState,
    composerThreadSummaries,
    composerThreadProjects,
    crossTaskOrigin,
    forkSource,
    handoffSource,
    isDragOverComposer,
    setIsDragOverComposer,
    expandedImage,
    setExpandedImage,
    setLocalDraftErrorsByThreadId,
    isRevertingCheckpoint,
    setIsRevertingCheckpoint,
    pendingFileUndo,
    setPendingFileUndo,

    activeTaskListCompact,
    setActiveTaskListCompact,
    subagentStripCompact,
    setSubagentStripCompact,
    workflowRunCardCompact,
    setWorkflowRunCardCompact,
    isComposerFooterCompact,
    setIsComposerFooterCompact,
    composerFooterTier,
    setComposerFooterTier,
    composerFooterTierRef,
    composerFooterDemotionWidthsRef,
    composerFooterLayoutSyncRef,
    composerCommandPicker,
    setComposerCommandPicker,
    isComposerExtrasPanelOpen,
    setIsComposerExtrasPanelOpen,

    composerHighlightedItemId,
    setComposerHighlightedItemId,
    pullRequestDialogState,
    setPullRequestDialogState,
    dismissedProviderHealthBannerKeys,
    setDismissedProviderHealthBannerKeys,
    dismissedRateLimitBannerKey,
    setDismissedRateLimitBannerKey,
    setIsModelPickerOpen,
    setIsTraitsPickerOpen,
    isComposerModelEffortPickerOpen,
    legendListRef,
    timelineControllerRef,
    threadFindOpen,
    setThreadFindOpen,
    threadFindFocusNonce,
    setThreadFindFocusNonce,
    threadFindHighlightStore,
    handleThreadFindJump,
    handleThreadFindActiveMatchChange,
    composerFormRef,
    commitAndPushTriggerRef,
    onRegisterCommitAndPushTrigger,
    pendingComposerFocusRef,
    composerSelectLockRef,
    composerMenuOpenRef,
    composerMenuItemsRef,
    activeComposerMenuItemRef,
    localDirectoryMenuRef,
    sendInFlightRef,
    sendPreflightInFlightRef,
    dragDepthRef,
    terminalOpenByThreadRef,
    activatedThreadIdRef,
    localDraftThread,
    activeThread,
  } as const;
}
