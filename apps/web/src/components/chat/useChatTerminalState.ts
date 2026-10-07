import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import { useEffect } from "react";

import { selectThreadTerminalState, useTerminalStateStore } from "~/terminalStateStore";
import { createChatTerminalFromShortcut } from "./chatTerminalActions";

export function useChatTerminalState(input: {
  threadId: ThreadId;
  activeThreadId: ThreadId | null;
  onOpenTerminal?: (() => void) | undefined;
}) {
  const { onOpenTerminal } = input;
  const terminalState = useTerminalStateStore((state) =>
    selectThreadTerminalState(state.terminalStateByThreadId, input.threadId),
  );
  const terminalWorkspaceOpen =
    terminalState.presentationMode === "workspace" && terminalState.terminalOpen;

  useEffect(() => {
    const onMenuAction = window.desktopBridge?.onMenuAction;
    if (typeof onMenuAction !== "function") return;
    return onMenuAction((action) => {
      if (action === "new-terminal-tab") {
        createChatTerminalFromShortcut({ activeThreadId: input.activeThreadId });
        onOpenTerminal?.();
      }
    });
  }, [input.activeThreadId, onOpenTerminal]);

  return {
    terminalState,
    terminalWorkspaceOpen,
  };
}
