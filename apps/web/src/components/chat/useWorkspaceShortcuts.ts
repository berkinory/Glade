import { useEffect, useEffectEvent } from "react";
import type { ThreadId } from "@glade/contracts/core/baseSchemas";

export function useWorkspaceShortcuts(props: {
  threadId: ThreadId;
  onNavigate: (direction: 1 | -1) => void;
  onClose: () => void;
}) {
  const navigate = useEffectEvent((event: Event) => {
    if (!(event instanceof CustomEvent)) return;
    const detail = event.detail as { threadId: ThreadId; direction: 1 | -1 };
    if (detail.threadId === props.threadId) props.onNavigate(detail.direction);
  });
  const close = useEffectEvent(props.onClose);
  useEffect(() => {
    window.addEventListener("glade:navigate-workspace-tab", navigate);
    window.addEventListener("glade:close-workspace-tab", close);
    const unsubscribe = window.desktopBridge?.onMenuAction?.((action) => {
      if (action === "close-workspace-tab") close();
    });
    return () => {
      window.removeEventListener("glade:navigate-workspace-tab", navigate);
      window.removeEventListener("glade:close-workspace-tab", close);
      unsubscribe?.();
    };
  }, []);
}
