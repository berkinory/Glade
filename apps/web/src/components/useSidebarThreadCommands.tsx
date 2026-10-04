import { useSplitViewStore } from "../splitViewStore";
import { useSidebarStateStore } from "../sidebarStateStore";
import { pinActionLabel } from "~/lib/pin";
import { THREAD_CONTEXT_MENU_ICONS } from "~/lib/contextMenuIcons";
import { type MouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { type OrchestrationThreadPullRequest } from "@glade/contracts/orchestration/threadEntities";
import { ThreadId } from "@glade/contracts/core/baseSchemas";
import { pluralize } from "@glade/shared/text/text";
import { resolveThreadWorkspaceCwd } from "@glade/shared/threads/threadEnvironment";
import { randomUUID } from "../lib/utils";
import { reconcileDeletedThreadsFromClient } from "../lib/deletedThreadClientReconciliation";
import { useStore } from "../store";
import { getThreadFromState } from "../threadDerivation";
import { readNativeApi } from "../nativeApi";
import { dispatchThreadRename } from "../lib/threadRename";
import { quotePosixShellArgument } from "../lib/shellQuote";
import { DEFAULT_THREAD_TERMINAL_ID, type SidebarThreadSummary } from "../types";
import { selectThreadTerminalState, useTerminalStateStore } from "../terminalStateStore";
import { toastManager } from "./ui/toast";
import type { LastThreadRoute } from "../chatRouteRestore";
import { useCopyPathToClipboard, useCopyThreadIdToClipboard } from "~/hooks/useCopyToClipboard";
import { useThreadActivationController } from "../hooks/useThreadActivationController";
import { useThreadDetailPrewarm } from "../threadDetailPrewarm";
import type { useSidebarProjectNavigation } from "./useSidebarProjectNavigation";

export function useSidebarThreadCommands(context: ReturnType<typeof useSidebarProjectNavigation>) {
  const {
    navigate,
    appSettings,
    routeThreadId,
    routeSearch,
    activeSplitView,
    setRenameDialogThreadId,
    setProjectContextMenuState,
    setOptimisticActiveThreadId,
    lastThreadRenameTapRef,
    clearDismissedThreadStatus,
    resolveThreadStatusForSidebar,
    clearThreadNotification,
    pinnedThreadIdSet,
    toggleThreadPinned,
    deleteThread,
    confirmAndDeleteThread,
    archiveThread,
    confirmAndArchiveThread,
    openPrLink,
    projectCwdById,
  } = context;
  const terminalStateByThreadId = useTerminalStateStore((state) => state.terminalStateByThreadId);
  const splitViewsById = useSplitViewStore((state) => state.splitViewsById);
  const sidebarThreadSummaryById = useStore((state) => state.sidebarThreadSummaryById);

  const markThreadUnread = useStore((state) => state.markThreadUnread);
  const openChatThreadPage = useTerminalStateStore((state) => state.openChatThreadPage);
  const openTerminalThreadPage = useTerminalStateStore((state) => state.openTerminalThreadPage);
  const setSplitFocusedPane = useSplitViewStore((state) => state.setFocusedPane);

  const selectedThreadIds = useSidebarStateStore((state) => state.selectedThreadIds);
  const clearSelection = useSidebarStateStore((state) => state.clearSelection);
  const removeFromSelection = useSidebarStateStore((state) => state.removeFromSelection);
  const setSelectionAnchor = useSidebarStateStore((state) => state.setAnchor);

  const setLastThreadRoute = useSidebarStateStore((state) => state.setLastThreadRoute);

  const commitRename = async (threadId: ThreadId, newTitle: string, originalTitle: string) => {
    const outcome = await dispatchThreadRename({
      threadId,
      newTitle,
      unchangedTitles: [originalTitle],
    }).catch((error) => {
      toastManager.add({
        type: "error",
        title: "Failed to rename thread",
        description: error instanceof Error ? error.message : "An error occurred.",
      });
      return null;
    });

    if (outcome === "empty") {
      toastManager.add({
        type: "warning",
        title: "Thread title cannot be empty",
      });
    }
  };

  const openRenameThreadDialog = (threadId: ThreadId) => {
    setRenameDialogThreadId(threadId);
  };

  const handleThreadRenamePointerUp = (
    event: ReactPointerEvent<HTMLElement>,
    threadId: ThreadId,
  ) => {
    if (event.pointerType !== "touch" && event.pointerType !== "pen") {
      return;
    }

    const previousTap = lastThreadRenameTapRef.current;
    const currentTapTimestamp = event.timeStamp;
    if (
      previousTap &&
      previousTap.threadId === threadId &&
      currentTapTimestamp - previousTap.timestamp <= 320
    ) {
      event.preventDefault();
      event.stopPropagation();
      lastThreadRenameTapRef.current = null;
      openRenameThreadDialog(threadId);
      return;
    }

    lastThreadRenameTapRef.current = {
      threadId,
      timestamp: currentTapTimestamp,
    };
  };

  const { prewarmThreadDetail: prewarmThreadDetailForIntent } = useThreadDetailPrewarm();

  const primeThreadActivation = (event: ReactPointerEvent<HTMLElement>, threadId: ThreadId) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    prewarmThreadDetailForIntent(threadId);
    setOptimisticActiveThreadId(threadId);
  };

  const copyThreadIdToClipboard = useCopyThreadIdToClipboard();

  const copyPathToClipboard = useCopyPathToClipboard();

  const handleThreadContextMenu = async (
    threadId: ThreadId,
    position: { x: number; y: number },
    options?: {
      extraItems?: Array<{
        id: "return-to-single-chat";
        label: string;
      }>;
      onExtraAction?: (itemId: "return-to-single-chat") => Promise<void> | void;
    },
  ) => {
    const api = readNativeApi();
    if (!api) return;
    const thread = getThreadFromState(useStore.getState(), threadId);
    if (!thread) return;
    const threadSummary = sidebarThreadSummaryById[threadId];
    const isPinned = pinnedThreadIdSet.has(threadId);
    const threadStatus = threadSummary ? resolveThreadStatusForSidebar(threadSummary) : null;
    const threadWorkspacePath = resolveThreadWorkspaceCwd({
      projectCwd: projectCwdById.get(thread.projectId) ?? null,
      envMode: thread.envMode,
      worktreePath: thread.worktreePath,
    });
    const clicked = await api.contextMenu.show(
      [
        { id: "rename", label: "Rename thread", icon: THREAD_CONTEXT_MENU_ICONS.rename },
        {
          id: "toggle-pin",
          label: pinActionLabel("thread", isPinned),
          icon: THREAD_CONTEXT_MENU_ICONS.pin,
        },
        ...(threadStatus?.dismissible
          ? [
              {
                id: "clear-notification",
                label: "Clear notification",
                icon: THREAD_CONTEXT_MENU_ICONS.clearNotification,
              },
            ]
          : []),
        { id: "mark-unread", label: "Mark unread", icon: THREAD_CONTEXT_MENU_ICONS.markUnread },
        {
          id: "copy-path",
          label: "Copy Path",
          icon: THREAD_CONTEXT_MENU_ICONS.copy,
          separatorBefore: true,
        },
        ...(threadWorkspacePath
          ? [
              {
                id: "open-path-in-terminal",
                label: "Open Path in Terminal",
                icon: THREAD_CONTEXT_MENU_ICONS.openInTerminal,
              },
            ]
          : []),
        { id: "copy-thread-id", label: "Copy Thread ID", icon: THREAD_CONTEXT_MENU_ICONS.copy },
        ...(options?.extraItems ?? []),

        ...(thread.parentThreadId
          ? []
          : [
              {
                id: "archive",
                label: "Archive",
                icon: THREAD_CONTEXT_MENU_ICONS.archive,
                separatorBefore: true,
              },
            ]),
        {
          id: "delete",
          label: "Delete",
          icon: THREAD_CONTEXT_MENU_ICONS.delete,
          destructive: true,
          ...(thread.parentThreadId ? { separatorBefore: true } : {}),
        },
      ],
      position,
    );

    if (clicked === "rename") {
      openRenameThreadDialog(threadId);
      return;
    }
    if (clicked === "toggle-pin") {
      toggleThreadPinned(threadId);
      return;
    }

    if (clicked === "mark-unread") {
      clearDismissedThreadStatus(threadId);
      markThreadUnread(threadId);
      return;
    }
    if (clicked === "clear-notification") {
      clearThreadNotification(threadId);
      return;
    }
    if (clicked === "copy-path") {
      if (!threadWorkspacePath) {
        toastManager.add({
          type: "error",
          title: "Path unavailable",
          description: "This thread does not have a workspace path to copy.",
        });
        return;
      }
      copyPathToClipboard(threadWorkspacePath);
      return;
    }
    if (clicked === "open-path-in-terminal") {
      if (!threadWorkspacePath) {
        toastManager.add({
          type: "error",
          title: "Path unavailable",
          description: "This thread does not have a workspace path to open.",
        });
        return;
      }
      await navigate({ to: "/$threadId", params: { threadId } });
      const terminalStore = useTerminalStateStore.getState();
      const currentTerminalState = selectThreadTerminalState(
        terminalStore.terminalStateByThreadId,
        threadId,
      );

      // Reuse the active terminal when one is already open and idle so that repeatedly invoking "Open
      // Path in Terminal" doesn't pile up tabs.
      const candidateBaseTerminalId =
        currentTerminalState.activeTerminalId ||
        currentTerminalState.terminalIds[0] ||
        DEFAULT_THREAD_TERMINAL_ID;
      const baseTerminalAvailable =
        currentTerminalState.terminalOpen &&
        currentTerminalState.terminalIds.includes(candidateBaseTerminalId) &&
        !currentTerminalState.runningTerminalIds.includes(candidateBaseTerminalId);
      const shouldCreateNewTerminal = !baseTerminalAvailable;
      const targetTerminalId = shouldCreateNewTerminal
        ? `terminal-${randomUUID()}`
        : candidateBaseTerminalId;

      const previousTerminalOpen = currentTerminalState.terminalOpen;
      const previousPresentationMode = currentTerminalState.presentationMode;
      const previousActiveTerminalId = currentTerminalState.activeTerminalId;

      terminalStore.setTerminalPresentationMode(threadId, "drawer");
      terminalStore.setTerminalOpen(threadId, true);
      if (shouldCreateNewTerminal) {
        terminalStore.newTerminal(threadId, targetTerminalId);
      } else {
        terminalStore.setActiveTerminal(threadId, targetTerminalId);
      }

      const cdCommand = `cd ${quotePosixShellArgument(threadWorkspacePath)}\r`;
      try {
        if (shouldCreateNewTerminal) {
          await api.terminal.open({
            threadId,
            terminalId: targetTerminalId,
            cwd: threadWorkspacePath,
          });
        }

        await api.terminal.write({
          threadId,
          terminalId: targetTerminalId,
          data: cdCommand,
        });
      } catch (error) {
        if (shouldCreateNewTerminal) {
          terminalStore.closeTerminal(threadId, targetTerminalId);
        }
        terminalStore.setTerminalPresentationMode(threadId, previousPresentationMode);
        terminalStore.setTerminalOpen(threadId, previousTerminalOpen);
        if (previousActiveTerminalId) {
          terminalStore.setActiveTerminal(threadId, previousActiveTerminalId);
        }
        toastManager.add({
          type: "error",
          title: "Unable to open terminal",
          description: error instanceof Error ? error.message : "The terminal could not be opened.",
        });
      }
      return;
    }
    if (clicked === "copy-thread-id") {
      copyThreadIdToClipboard(threadId);
      return;
    }
    if (clicked === "return-to-single-chat") {
      await options?.onExtraAction?.("return-to-single-chat");
      return;
    }
    if (clicked === "archive") {
      await confirmAndArchiveThread(threadId);
      return;
    }
    if (clicked !== "delete") return;
    await confirmAndDeleteThread(threadId);
  };

  const handleMultiSelectContextMenu = async (position: { x: number; y: number }) => {
    const api = readNativeApi();
    if (!api) return;
    const ids = [...selectedThreadIds];
    if (ids.length === 0) return;
    const count = ids.length;

    const clicked = await api.contextMenu.show(
      [
        {
          id: "mark-unread",
          label: `Mark unread (${count})`,
          icon: THREAD_CONTEXT_MENU_ICONS.markUnread,
        },
        { id: "archive", label: `Archive (${count})`, icon: THREAD_CONTEXT_MENU_ICONS.archive },
        {
          id: "delete",
          label: `Delete (${count})`,
          icon: THREAD_CONTEXT_MENU_ICONS.delete,
          destructive: true,
        },
      ],
      position,
    );

    if (clicked === "mark-unread") {
      for (const id of ids) {
        clearDismissedThreadStatus(id);
        markThreadUnread(id);
      }
      clearSelection();
      return;
    }

    if (clicked === "archive") {
      // Subagent threads follow their parent's archive cascade. Archiving one directly would strand it,
      // and archiving it after its parent in this loop would fail the not-archived invariant.
      const archiveIds = ids.filter(
        (id) => (getThreadFromState(useStore.getState(), id)?.parentThreadId ?? null) === null,
      );
      if (archiveIds.length === 0) {
        removeFromSelection(ids);
        return;
      }
      if (appSettings.confirmThreadArchive) {
        const confirmed = await api.dialogs.confirm(
          [
            `Archive ${archiveIds.length} ${pluralize(archiveIds.length, "thread")}?`,
            "Archived threads are hidden from the sidebar but can be restored later.",
          ].join("\n"),
        );
        if (!confirmed) return;
      }

      for (const id of archiveIds) {
        await archiveThread(id);
      }
      removeFromSelection(ids);
      return;
    }

    if (clicked !== "delete") return;

    if (appSettings.confirmThreadDelete) {
      const confirmed = await api.dialogs.confirm(
        [
          `Delete ${count} ${pluralize(count, "thread")}?`,
          "This permanently clears these conversations and deletes their Codex or Claude session history.",
        ].join("\n"),
      );
      if (!confirmed) return;
    }

    const deletedIds = new Set<ThreadId>(ids);
    const successfullyDeletedIds: ThreadId[] = [];
    const runDeletes = async (): Promise<void> => {
      for (const id of ids) {
        await deleteThread(id, { deletedThreadIds: deletedIds, reconcileDeletedThread: false });
        successfullyDeletedIds.push(id);
      }
    };
    await runDeletes().finally(() => {
      if (successfullyDeletedIds.length > 0) {
        void reconcileDeletedThreadsFromClient({
          threadIds: successfullyDeletedIds,
          removeDeletedThreadFromClientState:
            useStore.getState().removeDeletedThreadFromClientState,
        });
      }
    });
    removeFromSelection(ids);
  };

  const rememberLastThreadRouteNow = (nextLastThreadRoute: LastThreadRoute) => {
    setLastThreadRoute(nextLastThreadRoute);
  };

  const { activateThreadFromSidebarIntent } = useThreadActivationController({
    activeSplitView,
    clearSelection,
    navigate,
    openChatThreadPage,
    openTerminalThreadPage,
    prewarmThreadDetailForIntent,
    rememberLastThreadRouteNow,
    routeSplitViewId: routeSearch.splitViewId,
    routeThreadId,
    selectedThreadCount: selectedThreadIds.size,
    setOptimisticActiveThreadId,
    setSelectionAnchor,
    setSplitFocusedPane,
    sidebarThreadSummaryById,
    splitViewsById,
    terminalStateByThreadId,
  });

  const openThreadPullRequest = (
    event: MouseEvent<HTMLElement>,
    _thread: SidebarThreadSummary,
    pr: OrchestrationThreadPullRequest,
  ) => {
    openPrLink(event, pr.url);
  };

  const handleCloseProjectContextMenu = () => setProjectContextMenuState(null);
  return {
    ...context,
    commitRename,
    openRenameThreadDialog,
    handleThreadRenamePointerUp,
    primeThreadActivation,
    copyPathToClipboard,
    handleThreadContextMenu,
    handleMultiSelectContextMenu,
    activateThreadFromSidebarIntent,
    openThreadPullRequest,
    handleCloseProjectContextMenu,
  };
}
