import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";

import type { ThreadId } from "@glade/contracts";

export type SidebarRowContextMenuPosition = { x: number; y: number };

export type SidebarThreadRowGestureProps = {
  onDoubleClick: (event: ReactMouseEvent<HTMLElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  onContextMenu: (event: ReactMouseEvent<HTMLElement>) => void;
};

export function createSidebarThreadRowGestures({
  threadId,
  onRename,
  onRenamePointerUp,
  onContextMenu,
}: {
  threadId: ThreadId;
  onRename: (threadId: ThreadId) => void;

  onRenamePointerUp: (event: ReactPointerEvent<HTMLElement>, threadId: ThreadId) => void;
  onContextMenu: (threadId: ThreadId, position: SidebarRowContextMenuPosition) => void;
}): SidebarThreadRowGestureProps {
  return {
    onDoubleClick: (event) => {
      event.preventDefault();
      event.stopPropagation();
      onRename(threadId);
    },
    onPointerUp: (event) => {
      onRenamePointerUp(event, threadId);
    },
    onContextMenu: (event) => {
      event.preventDefault();
      event.stopPropagation();
      onContextMenu(threadId, { x: event.clientX, y: event.clientY });
    },
  };
}
