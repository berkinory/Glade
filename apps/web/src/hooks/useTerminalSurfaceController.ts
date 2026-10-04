import type { TerminalSplitDirection } from "~/terminalLayout";
import { type ThreadId } from "@glade/contracts/core/baseSchemas";
import { type TerminalCliKind } from "@glade/shared/threads/terminalThreads";
import { useState } from "react";

import { useAppSettings } from "~/appSettings";
import {
  confirmTerminalTabClose,
  resolveTerminalCloseTitle,
  shouldPromptForTerminalClose,
} from "~/lib/terminalCloseConfirmation";
import { readNativeApi } from "~/nativeApi";
import { selectThreadTerminalState, useTerminalStateStore } from "~/terminalStateStore";
import { randomTerminalId } from "~/components/terminal/terminalIds";
import { disposeAndCloseTerminalSession } from "~/components/terminal/terminalSession";

type TerminalMetadata = { cliKind: TerminalCliKind | null; label: string };
type TerminalActivity = {
  hasRunningSubprocess: boolean;
  agentState: "running" | "attention" | "review" | null;
};

export function useTerminalSurfaceController(threadId: ThreadId) {
  const { settings } = useAppSettings();
  const terminalState = useTerminalStateStore((state) =>
    selectThreadTerminalState(state.terminalStateByThreadId, threadId),
  );
  const openTerminalThreadPage = useTerminalStateStore((s) => s.openTerminalThreadPage);
  const newTerminal = useTerminalStateStore((s) => s.newTerminal);
  const setActiveTerminalStore = useTerminalStateStore((s) => s.setActiveTerminal);
  const closeTerminalAndEnsureReplacementStore = useTerminalStateStore(
    (s) => s.closeTerminalAndEnsureReplacement,
  );
  const closeTerminalStore = useTerminalStateStore((s) => s.closeTerminal);
  const closeExitedTerminalStore = useTerminalStateStore((s) => s.closeExitedTerminal);
  const setTerminalHeightStore = useTerminalStateStore((s) => s.setTerminalHeight);
  const setTerminalMetadataStore = useTerminalStateStore((s) => s.setTerminalMetadata);
  const setTerminalActivityStore = useTerminalStateStore((s) => s.setTerminalActivity);

  const [focusRequestId, setFocusRequestId] = useState(0);
  const bumpFocusRequest = () => setFocusRequestId((value) => value + 1);

  const createTerminal = () => {
    const terminalId = randomTerminalId();
    newTerminal(threadId, terminalId);
    bumpFocusRequest();
    return terminalId;
  };

  const splitTerminal = (direction: TerminalSplitDirection) => {
    useTerminalStateStore.getState().splitTerminal(threadId, randomTerminalId(), direction);
    bumpFocusRequest();
  };

  const closeTerminalGroup = async (terminalIds: readonly string[], onLastClosed: () => void) => {
    const api = readNativeApi();
    const current = selectThreadTerminalState(
      useTerminalStateStore.getState().terminalStateByThreadId,
      threadId,
    );
    const confirmed = await confirmTerminalTabClose({
      api,
      enabled: terminalIds.some((terminalId) =>
        shouldPromptForTerminalClose({
          confirmationEnabled: settings.confirmTerminalTabClose,
          runningTerminalIds: current.runningTerminalIds,
          terminalAttentionStatesById: current.terminalAttentionStatesById,
          terminalId,
        }),
      ),
      terminalTitle: resolveTerminalCloseTitle({
        terminalId: terminalIds[0] ?? current.activeTerminalId,
        ...current,
      }),
    });
    if (!confirmed) return;
    const latest = selectThreadTerminalState(
      useTerminalStateStore.getState().terminalStateByThreadId,
      threadId,
    );
    const closingFinal = latest.terminalIds.every((id) => terminalIds.includes(id));
    for (const terminalId of terminalIds) {
      if (!latest.terminalIds.includes(terminalId)) continue;
      disposeAndCloseTerminalSession({ api, threadId, terminalId });
      closeTerminalStore(threadId, terminalId);
    }
    if (closingFinal) onLastClosed();
    bumpFocusRequest();
  };

  const activateTerminal = (terminalId: string) => {
    setActiveTerminalStore(threadId, terminalId);
    bumpFocusRequest();
  };

  const closeTerminal = async (terminalId: string, onLastClosed?: () => void) => {
    const api = readNativeApi();
    const confirmed = await confirmTerminalTabClose({
      api,
      enabled: shouldPromptForTerminalClose({
        confirmationEnabled: settings.confirmTerminalTabClose,
        runningTerminalIds: terminalState.runningTerminalIds,
        terminalAttentionStatesById: terminalState.terminalAttentionStatesById,
        terminalId,
      }),
      terminalTitle: resolveTerminalCloseTitle({
        terminalId,
        terminalLabelsById: terminalState.terminalLabelsById,
        terminalTitleOverridesById: terminalState.terminalTitleOverridesById,
      }),
    });
    if (!confirmed) {
      return;
    }
    disposeAndCloseTerminalSession({ api, threadId, terminalId });
    if (onLastClosed) {
      const finalTerminal =
        selectThreadTerminalState(
          useTerminalStateStore.getState().terminalStateByThreadId,
          threadId,
        ).terminalIds.length === 1;
      closeTerminalStore(threadId, terminalId);
      if (finalTerminal) onLastClosed();
    } else {
      closeTerminalAndEnsureReplacementStore(threadId, terminalId, randomTerminalId());
    }
    bumpFocusRequest();
  };

  const disposeExitedTerminal = (terminalId: string) => {
    disposeAndCloseTerminalSession({
      api: readNativeApi(),
      threadId,
      terminalId,
      processAlreadyExited: true,
    });
  };

  const handleTerminalSessionExited = (terminalId: string) => {
    disposeExitedTerminal(terminalId);
    closeTerminalAndEnsureReplacementStore(threadId, terminalId, randomTerminalId());
    bumpFocusRequest();
  };

  const handleDockTerminalSessionExited = (terminalId: string) => {
    disposeExitedTerminal(terminalId);
    const disposition = closeExitedTerminalStore(threadId, terminalId);
    bumpFocusRequest();
    return disposition;
  };

  const setTerminalHeight = (height: number) => setTerminalHeightStore(threadId, height);

  const setTerminalMetadata = (terminalId: string, metadata: TerminalMetadata) =>
    setTerminalMetadataStore(threadId, terminalId, metadata);

  const setTerminalActivity = (terminalId: string, activity: TerminalActivity) =>
    setTerminalActivityStore(threadId, terminalId, activity);

  return {
    terminalState,
    focusRequestId,
    bumpFocusRequest,
    openTerminalThreadPage,
    createTerminal,
    splitTerminal,
    closeTerminalGroup,
    activateTerminal,
    closeTerminal,
    handleTerminalSessionExited,
    handleDockTerminalSessionExited,
    setTerminalHeight,
    setTerminalMetadata,
    setTerminalActivity,
  };
}
