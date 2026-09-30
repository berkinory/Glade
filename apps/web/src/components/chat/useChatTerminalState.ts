import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import { useCallback, useEffect, useState } from "react";

import { selectThreadTerminalState, useTerminalStateStore } from "~/terminalStateStore";
import { createChatTerminalFromShortcut } from "./chatTerminalActions";

export function useChatTerminalState(input: {
  threadId: ThreadId;
  activeThreadId: ThreadId | null;
  isFocusedPane: boolean;
}) {
  const terminalState = useTerminalStateStore((state) =>
    selectThreadTerminalState(state.terminalStateByThreadId, input.threadId),
  );
  const [terminalFocusRequestId, setTerminalFocusRequestId] = useState(0);
  const requestTerminalFocus = useCallback(() => {
    setTerminalFocusRequestId((value) => value + 1);
  }, []);
  const terminalWorkspaceOpen =
    terminalState.presentationMode === "workspace" && terminalState.terminalOpen;
  const terminalWorkspaceTerminalTabActive =
    terminalWorkspaceOpen &&
    (terminalState.workspaceLayout === "terminal-only" ||
      terminalState.workspaceActiveTab === "terminal");
  const terminalWorkspaceChatTabActive =
    terminalWorkspaceOpen &&
    terminalState.workspaceLayout === "both" &&
    terminalState.workspaceActiveTab === "chat";

  useEffect(() => {
    const onMenuAction = window.desktopBridge?.onMenuAction;
    if (typeof onMenuAction !== "function" || !input.isFocusedPane) return;
    return onMenuAction((action) => {
      if (action === "new-terminal-tab") {
        createChatTerminalFromShortcut(
          { activeThreadId: input.activeThreadId, requestTerminalFocus },
          terminalState,
        );
      }
    });
  }, [input.activeThreadId, input.isFocusedPane, requestTerminalFocus, terminalState]);

  return {
    terminalState,
    terminalFocusRequestId,
    requestTerminalFocus,
    terminalWorkspaceOpen,
    terminalWorkspaceTerminalTabActive,
    terminalWorkspaceChatTabActive,
  };
}
