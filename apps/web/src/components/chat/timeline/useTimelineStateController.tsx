import { type MessageId } from "@glade/contracts/core/baseSchemas";

import { type LegendListRef } from "@legendapp/list/react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { DEFAULT_CHAT_FONT_SIZE_PX, normalizeChatFontSizePx } from "~/appSettings";
import {
  getChatMessageFooterTextStyle,
  getChatTranscriptTextStyle,
  getChatTranscriptUserMessageTextStyle,
} from "~/components/chat/chatTypography";
import { composerOverlayScrollMaskImage } from "~/components/chat/composerOverlay";
import { CHAT_COLUMN_FRAME_CLASS_NAME } from "~/components/chat/composerPickerStyles";
import { ForkSourceDivider } from "~/components/chat/ForkSourceDivider";
import { deriveMessagesTimelineRows } from "~/components/chat/MessagesTimeline.logic.rows";
import { findLastLiveWorkGroupId } from "~/components/chat/MessagesTimeline.logic.rowTypes";
import { type ThreadFindMatch } from "~/components/chat/threadFind.logic";
import { useTailAnchorScroll } from "~/components/chat/useTailAnchorScroll";
import { useTimelineRowOverlapGuard } from "~/components/chat/useTimelineRowOverlapGuard";
import { getAppTypographyScale } from "~/lib/appTypography";
import { cn } from "~/lib/utils";
import {
  BOTTOM_CONTENT_INSET_PX,
  EMPTY_AVAILABLE_EDITORS,
  EMPTY_EDITOR_KEYBINDINGS,
  EMPTY_MESSAGE_ID_SET,
} from "./timelineSupport";
import {
  useMessageSendEnterAnimations,
  useSettledTurnCollapseTransitions,
  useStableRows,
  useWorktreeSetupPresentation,
} from "./timelineTransitions";

import type { MessagesTimelineProps } from "./timelineSupport";
export function useTimelineStateController(props: MessagesTimelineProps) {
  const {
    isWorking,
    workingLabel: workingLabelProp,
    activeTurnInProgress,
    worktreeSetup: worktreeSetupProp,
    worktreeSetupPendingAction: worktreeSetupPendingActionProp,
    followLiveOutput: followLiveOutputProp,
    listRef,
    pinnedMessageIds,

    enteringUserMessageIds: enteringUserMessageIdsProp,
    tailAnchorMessageId: tailAnchorMessageIdProp,
    tailAnchorScrollInFlightRef,
    crossTaskOrigin: crossTaskOriginProp,
    forkSource: forkSourceProp,
    handoffSource: handoffSourceProp,
    timelineEntries,
    messageChangeSignal: messageChangeSignalProp,
    turnDiffSummaryByAssistantMessageId,
    onOpenThread,
    activeTurnId,
    chatFontSizePx: chatFontSizePxProp,
    keybindings,
    availableEditors,
    contentInsetRightPx,
    contentInsetBottomPx,
    contentInsetBottomClearancePx,
    findHighlight: findHighlightProp,
  }: MessagesTimelineProps = props;

  const workingLabel = workingLabelProp ?? "Thinking";

  const worktreeSetup = worktreeSetupProp ?? null;

  const worktreeSetupPendingAction = worktreeSetupPendingActionProp ?? null;

  const followLiveOutput = followLiveOutputProp ?? false;

  const enteringUserMessageIds = enteringUserMessageIdsProp ?? EMPTY_MESSAGE_ID_SET;

  const tailAnchorMessageId = tailAnchorMessageIdProp ?? null;

  const forkSource = forkSourceProp ?? null;

  const handoffSource = handoffSourceProp ?? null;

  const findHighlight = findHighlightProp ?? null;

  const editorKeybindings = keybindings ?? EMPTY_EDITOR_KEYBINDINGS;

  const installedEditors = availableEditors ?? EMPTY_AVAILABLE_EDITORS;

  const [inheritedTailAnchorMessageId] = useState<MessageId | null>(
    () => tailAnchorMessageIdProp ?? null,
  );

  const hasInheritedTailAnchor =
    inheritedTailAnchorMessageId !== null && tailAnchorMessageId === inheritedTailAnchorMessageId;

  const [settledTailAnchorMessageId, setSettledTailAnchorMessageId] = useState<MessageId | null>(
    () => inheritedTailAnchorMessageId,
  );

  const tailAnchorSlideInFlight =
    tailAnchorMessageId !== null && tailAnchorMessageId !== settledTailAnchorMessageId;

  const handleTailAnchorSlideFinished = useCallback(
    (messageId: MessageId) => {
      setSettledTailAnchorMessageId((current) => (current === messageId ? current : messageId));
    },
    [setSettledTailAnchorMessageId],
  );

  const crossTaskOrigin = crossTaskOriginProp ?? null;

  const normalizedChatFontSizePx = normalizeChatFontSizePx(
    chatFontSizePxProp ?? DEFAULT_CHAT_FONT_SIZE_PX,
  );

  const listScrollStyle = useMemo(() => {
    const style: CSSProperties = { width: "100%" };
    if (contentInsetRightPx) {
      style.paddingRight = contentInsetRightPx;
    }
    if (contentInsetBottomPx) {
      style.paddingBottom = contentInsetBottomPx;
      const maskImage = composerOverlayScrollMaskImage(
        contentInsetBottomPx,
        contentInsetBottomClearancePx,
      );
      if (maskImage) {
        style.maskImage = maskImage;
        style.WebkitMaskImage = maskImage;
      }
    }
    return style;
  }, [contentInsetBottomClearancePx, contentInsetBottomPx, contentInsetRightPx]);

  const appTypographyScale = useMemo(
    () => getAppTypographyScale(normalizedChatFontSizePx),
    [normalizedChatFontSizePx],
  );

  const chatTypographyStyle = useMemo(
    () => getChatTranscriptTextStyle(normalizedChatFontSizePx),
    [normalizedChatFontSizePx],
  );

  const userMessageTypographyStyle = useMemo(
    () => getChatTranscriptUserMessageTextStyle(normalizedChatFontSizePx),
    [normalizedChatFontSizePx],
  );

  const chatMessageFooterStyle = useMemo(
    () => getChatMessageFooterTextStyle(normalizedChatFontSizePx),
    [normalizedChatFontSizePx],
  );

  const [expandedCollapsedWork, setExpandedCollapsedWork] = useState<Record<string, boolean>>({});

  const setCollapsedWorkExpanded = useCallback(
    (messageId: string, open: boolean) => {
      setExpandedCollapsedWork((current) => ({
        ...current,
        [messageId]: open,
      }));
    },
    [setExpandedCollapsedWork],
  );

  const [toolGroupSummaryOverrides, setToolGroupSummaryOverrides] = useState<
    Record<string, boolean>
  >({});

  const setToolGroupSummaryOpen = useCallback(
    (groupKey: string, open: boolean) => {
      setToolGroupSummaryOverrides((current) => ({
        ...current,
        [groupKey]: open,
      }));
    },
    [setToolGroupSummaryOverrides],
  );

  const [expandedFileChangesByTurnId, setExpandedFileChangesByTurnId] = useState<
    Record<string, boolean>
  >({});

  const [expandedUserMessagesById, setExpandedUserMessagesById] = useState<Record<string, boolean>>(
    {},
  );

  const [editingUserMessageId, setEditingUserMessageId] = useState<MessageId | null>(null);

  const [submittingEditedUserMessageId, setSubmittingEditedUserMessageId] =
    useState<MessageId | null>(null);

  const [highlightedMessageId, setHighlightedMessageId] = useState<MessageId | null>(null);

  const fallbackListRef = useRef<LegendListRef | null>(null);

  const resolvedListRef = listRef ?? fallbackListRef;

  const timelineRootRef = useRef<HTMLDivElement | null>(null);

  const activeFindMatchRef = useRef<ThreadFindMatch | null>(null);

  useLayoutEffect(() => {
    activeFindMatchRef.current = findHighlight?.activeMatch ?? null;
  }, [findHighlight, activeFindMatchRef]);

  const observeTimelineRow = useTimelineRowOverlapGuard();

  useTailAnchorScroll({
    listRef: resolvedListRef,
    timelineRootRef,

    anchorMessageId: hasInheritedTailAnchor ? null : tailAnchorMessageId,
    anchorScrollInFlightRef: tailAnchorScrollInFlightRef,
    onAnchorSlideFinished: handleTailAnchorSlideFinished,
    contentChangeSignal: timelineEntries,
    messageChangeSignal: messageChangeSignalProp ?? timelineEntries,
    animateAnchorSlide: !followLiveOutput,
  });

  const presentedWorktreeSetup = useWorktreeSetupPresentation(worktreeSetup);

  const rawRows = useMemo(
    () =>
      deriveMessagesTimelineRows({
        timelineEntries,
        isWorking,
        worktreeSetup: presentedWorktreeSetup?.snapshot ?? null,
        worktreeSetupOpen: presentedWorktreeSetup?.open ?? false,
        activeTurnInProgress,
        activeTurnId,
        turnDiffSummaryByAssistantMessageId,
      }),
    [
      timelineEntries,
      isWorking,
      presentedWorktreeSetup,
      activeTurnInProgress,
      activeTurnId,
      turnDiffSummaryByAssistantMessageId,
    ],
  );

  const rows = useStableRows(rawRows);

  const originSource = handoffSource ?? forkSource;

  const canRenderForkSourceDivider = originSource !== null && onOpenThread !== undefined;

  const forkSourceDivider = useMemo(
    () =>
      originSource && onOpenThread ? (
        <ForkSourceDivider source={originSource} onOpenSourceThread={onOpenThread} />
      ) : null,
    [originSource, onOpenThread],
  );

  const forkDividerBeforeRowId = useMemo(() => {
    if (!canRenderForkSourceDivider) {
      return null;
    }
    let lastImportedMessageIndex = -1;
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index]!;
      if (
        row.kind === "message" &&
        (row.message.source === "fork-import" || row.message.source === "handoff-import")
      ) {
        lastImportedMessageIndex = index;
      }
    }
    return rows[lastImportedMessageIndex + 1]?.id ?? null;
  }, [canRenderForkSourceDivider, rows]);

  const forkDividerAtEnd = canRenderForkSourceDivider && forkDividerBeforeRowId === null;

  const listFooter = useMemo(
    () => (
      <>
        {forkDividerAtEnd ? (
          <div className={cn(CHAT_COLUMN_FRAME_CLASS_NAME, "px-1")}>{forkSourceDivider}</div>
        ) : null}
        <div
          aria-hidden="true"
          data-tail-anchor-spacer="true"
          style={{ height: BOTTOM_CONTENT_INSET_PX }}
        />
      </>
    ),
    [forkDividerAtEnd, forkSourceDivider],
  );

  const tailAnchorRowIndex = useMemo(() => {
    if (tailAnchorMessageId === null) {
      return -1;
    }
    return rows.findIndex(
      (row) => row.kind === "message" && row.message.id === tailAnchorMessageId,
    );
  }, [rows, tailAnchorMessageId]);

  const [anchorVerticalInsetPx, setAnchorVerticalInsetPx] = useState(0);

  useLayoutEffect(() => {
    if (tailAnchorMessageId === null) {
      return;
    }
    const node: unknown = resolvedListRef.current?.getScrollableNode?.();
    if (!(node instanceof HTMLElement)) {
      return;
    }
    const style = getComputedStyle(node);

    const bottomPadding = Math.max(
      0,
      (Number.parseFloat(style.paddingBottom) || 0) - (contentInsetBottomPx ?? 0),
    );
    const inset = (Number.parseFloat(style.paddingTop) || 0) + bottomPadding;
    setAnchorVerticalInsetPx((current) => (Math.abs(current - inset) > 0.5 ? inset : current));
  }, [contentInsetBottomPx, resolvedListRef, tailAnchorMessageId, setAnchorVerticalInsetPx]);

  const anchoredEndSpace = useMemo(
    () =>
      tailAnchorRowIndex < 0
        ? undefined
        : {
            anchorIndex: tailAnchorRowIndex,
            anchorOffset: anchorVerticalInsetPx,
          },
    [anchorVerticalInsetPx, tailAnchorRowIndex],
  );

  useEffect(() => {
    const state = resolvedListRef.current?.getState?.();
    const listenForAnchoredEndSpace = state?.listen as
      | ((listenerType: "anchoredEndSpaceSize", callback: (size: number) => void) => () => void)
      | undefined;
    return listenForAnchoredEndSpace?.("anchoredEndSpaceSize", (size) => {
      timelineRootRef.current?.setAttribute("data-anchored-end-space", String(Math.round(size)));
    });
  }, [resolvedListRef, timelineRootRef]);

  const lastLiveWorkGroupId = useMemo(() => findLastLiveWorkGroupId(rows), [rows]);

  const firstUserMessageId = useMemo(() => {
    for (const row of rows) {
      if (row.kind === "message" && row.message.role === "user") {
        return row.message.id;
      }
    }
    return null;
  }, [rows]);

  const settledTurnCollapseTransitions = useSettledTurnCollapseTransitions(rows);

  const enteringMessageRowIds = useMessageSendEnterAnimations(rows, enteringUserMessageIds);

  const timelineExtraData = useMemo(
    () => ({
      crossTaskOrigin,
      editingUserMessageId,
      enteringMessageRowIds,
      expandedCollapsedWork,
      expandedFileChangesByTurnId,
      expandedUserMessagesById,
      findHighlight,
      firstUserMessageId,
      highlightedMessageId,
      lastLiveWorkGroupId,
      pinnedMessageIds,
      settledTurnCollapseTransitions,
      submittingEditedUserMessageId,
      toolGroupSummaryOverrides,
    }),
    [
      crossTaskOrigin,
      editingUserMessageId,
      enteringMessageRowIds,
      expandedCollapsedWork,
      expandedFileChangesByTurnId,
      expandedUserMessagesById,
      findHighlight,
      firstUserMessageId,
      highlightedMessageId,
      lastLiveWorkGroupId,
      pinnedMessageIds,
      settledTurnCollapseTransitions,
      submittingEditedUserMessageId,
      toolGroupSummaryOverrides,
    ],
  );
  return {
    workingLabel,
    worktreeSetupPendingAction,
    followLiveOutput,
    tailAnchorMessageId,
    findHighlight,
    editorKeybindings,
    installedEditors,
    hasInheritedTailAnchor,
    tailAnchorSlideInFlight,
    crossTaskOrigin,
    normalizedChatFontSizePx,
    listScrollStyle,
    appTypographyScale,
    chatTypographyStyle,
    userMessageTypographyStyle,
    chatMessageFooterStyle,
    expandedCollapsedWork,
    setCollapsedWorkExpanded,
    toolGroupSummaryOverrides,
    setToolGroupSummaryOpen,
    expandedFileChangesByTurnId,
    setExpandedFileChangesByTurnId,
    expandedUserMessagesById,
    setExpandedUserMessagesById,
    editingUserMessageId,
    setEditingUserMessageId,
    submittingEditedUserMessageId,
    setSubmittingEditedUserMessageId,
    highlightedMessageId,
    setHighlightedMessageId,

    resolvedListRef,
    timelineRootRef,
    activeFindMatchRef,
    observeTimelineRow,
    rows,
    canRenderForkSourceDivider,
    forkSourceDivider,
    forkDividerBeforeRowId,
    listFooter,
    anchoredEndSpace,
    lastLiveWorkGroupId,
    firstUserMessageId,
    settledTurnCollapseTransitions,
    enteringMessageRowIds,
    timelineExtraData,
  } as const;
}
