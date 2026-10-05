import { useEffect, useEffectEvent } from "react";
import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import type { TerminalSplitDirection } from "~/terminalLayout";

export function useWorkspaceShortcuts(props: {
  threadId: ThreadId;
  onNavigate: (direction: 1 | -1) => void;
  onClose: () => void;
  terminalActive: boolean;
  onSplitTerminal: (direction: TerminalSplitDirection) => void;
}) {
  const navigate = useEffectEvent((event: Event) => {
    if (!(event instanceof CustomEvent)) return;
    const detail = event.detail as { threadId: ThreadId; direction: 1 | -1 };
    if (detail.threadId === props.threadId) props.onNavigate(detail.direction);
  });
  const close = useEffectEvent(props.onClose);
  const splitTerminal = useEffectEvent((event: KeyboardEvent) => {
    if (
      !props.terminalActive ||
      event.isComposing ||
      event.repeat ||
      event.altKey ||
      !(event.metaKey || event.ctrlKey) ||
      event.key.toLowerCase() !== "d"
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    props.onSplitTerminal(event.shiftKey ? "horizontal" : "vertical");
  });
  useEffect(() => {
    window.addEventListener("glade:navigate-workspace-tab", navigate);
    window.addEventListener("glade:close-workspace-tab", close);
    window.addEventListener("keydown", splitTerminal, true);
    const unsubscribe = window.desktopBridge?.onMenuAction?.((action) => {
      if (action === "close-workspace-tab") close();
    });
    return () => {
      window.removeEventListener("glade:navigate-workspace-tab", navigate);
      window.removeEventListener("glade:close-workspace-tab", close);
      window.removeEventListener("keydown", splitTerminal, true);
      unsubscribe?.();
    };
  }, []);
}
