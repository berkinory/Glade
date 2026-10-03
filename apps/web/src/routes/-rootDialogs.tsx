import { useQuery } from "@tanstack/react-query";
import { Suspense, lazy, useEffect, useState } from "react";
import { shouldRenderTerminalWorkspace } from "../components/ChatView.logic.subagents";
import { FeedbackDialog } from "../components/FeedbackDialog";
import ShortcutsDialog from "../components/ShortcutsDialog";
import WhatsNewDialog from "../components/WhatsNewDialog";
import type { FeedbackThreadContext } from "../feedback";
import { useFeedbackDialogStore } from "../feedbackDialogStore";
import { useFocusedChatContext } from "../focusedChatContext";
import { serverConfigQueryOptions } from "../lib/serverReactQuery";
import { isTerminalFocused } from "../lib/terminalFocus";
import { getNavigatorPlatform } from "../lib/utils";
import { useOnboarding } from "../onboarding/useOnboarding";
import { useProjectImportDialogStore } from "../projectImport/projectImportDialogStore";
import { selectThreadTerminalState, useTerminalStateStore } from "../terminalStateStore";
import { useWhatsNew } from "../whatsNew/useWhatsNew";
import { WhatsNewPopoutCard } from "../whatsNew/WhatsNewPopoutCard";

export function GlobalShortcutsDialog() {
  const [open, setOpen] = useState(false);
  const { focusedThreadId } = useFocusedChatContext();
  const serverConfigQuery = useQuery(serverConfigQueryOptions());
  const keybindings = serverConfigQuery.data?.keybindings ?? [];
  const platform = getNavigatorPlatform();
  const activeThreadTerminalState = useTerminalStateStore((state) =>
    focusedThreadId
      ? selectThreadTerminalState(state.terminalStateByThreadId, focusedThreadId)
      : null,
  );
  const terminalOpen = activeThreadTerminalState?.terminalOpen ?? false;
  const terminalWorkspaceOpen = shouldRenderTerminalWorkspace({
    presentationMode: activeThreadTerminalState?.presentationMode ?? "drawer",
    terminalOpen,
  });

  useEffect(() => {
    const onMenuAction = window.desktopBridge?.onMenuAction;
    if (typeof onMenuAction !== "function") {
      return;
    }

    const unsubscribe = onMenuAction((action) => {
      if (action === "show-shortcuts") {
        setOpen(true);
      }
    });

    return () => {
      unsubscribe?.();
    };
  }, []);

  return (
    <ShortcutsDialog
      open={open}
      onOpenChange={setOpen}
      keybindings={keybindings}
      platform={platform}
      context={{
        terminalFocus: isTerminalFocused(),
        terminalOpen,
        terminalWorkspaceOpen,
      }}
    />
  );
}
export function GlobalFeedbackDialog() {
  const { activeProject, activeThread } = useFocusedChatContext();
  const isOpen = useFeedbackDialogStore((state) => state.isOpen);
  const requestedContext = useFeedbackDialogStore((state) => state.context);
  const setOpen = useFeedbackDialogStore((state) => state.setOpen);
  const context: FeedbackThreadContext = requestedContext ?? {
    provider: activeThread?.modelSelection.provider ?? null,
    model: activeThread?.modelSelection.model ?? null,
    projectKind: activeProject?.kind ?? null,
    environmentMode: activeThread?.envMode ?? null,
    runtimeMode: activeThread?.runtimeMode ?? null,

    sessionStatus: activeThread?.sessionStatus ?? null,
    latestTurnState: activeThread?.latestTurnState ?? null,
    messageCount: activeThread?.messageCount ?? 0,
    activityCount: activeThread?.activityCount ?? 0,
    hasPendingApproval: activeThread?.hasPendingApprovals === true,
    hasPendingUserInput: activeThread?.hasPendingUserInput === true,
    hasThreadError: Boolean(activeThread?.error),
  };

  return <FeedbackDialog open={isOpen} context={context} onOpenChange={setOpen} />;
}
const OnboardingDialog = lazy(() =>
  import("../onboarding/OnboardingDialog").then((module) => ({
    default: module.OnboardingDialog,
  })),
);
export function GlobalOnboardingDialog() {
  const onboarding = useOnboarding();

  const [hasOpened, setHasOpened] = useState(false);
  useEffect(() => {
    if (onboarding.isOpen) setHasOpened(true);
  }, [onboarding.isOpen]);
  if (!hasOpened) return null;
  return (
    <Suspense fallback={null}>
      <OnboardingDialog
        open={onboarding.isOpen}
        onOpenChange={onboarding.onOpenChange}
        onComplete={onboarding.complete}
      />
    </Suspense>
  );
}
const ProjectImportDialog = lazy(() =>
  import("../projectImport/ProjectImportDialog").then((module) => ({
    default: module.ProjectImportDialog,
  })),
);
export function GlobalProjectImportDialog() {
  const isOpen = useProjectImportDialogStore((store) => store.isOpen);
  const [hasOpened, setHasOpened] = useState(false);
  useEffect(() => {
    if (isOpen) setHasOpened(true);
  }, [isOpen]);
  if (!isOpen && !hasOpened) return null;
  return (
    <Suspense fallback={null}>
      <ProjectImportDialog />
    </Suspense>
  );
}
export function GlobalWhatsNewSurface() {
  const {
    currentEntry,
    allEntries,
    currentVersion,
    isPopoutVisible,
    isDialogOpen,
    openDialog,
    dismissPopout,
    onDialogOpenChange,
  } = useWhatsNew();

  if (!currentEntry) {
    return null;
  }

  return (
    <>
      {isPopoutVisible && (
        <WhatsNewPopoutCard
          currentVersion={currentVersion}
          onOpen={openDialog}
          onDismiss={dismissPopout}
        />
      )}
      <WhatsNewDialog
        open={isDialogOpen}
        onOpenChange={onDialogOpenChange}
        currentEntry={currentEntry}
        allEntries={allEntries}
        currentVersion={currentVersion}
      />
    </>
  );
}
