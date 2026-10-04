import { useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "~/lib/utils";
import { WorkspaceHeaderContext } from "./WorkspaceHeaderContext";

export function ChatSurfaceHeader(props: {
  readonly hidden?: boolean;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  const workspaceHeader = useContext(WorkspaceHeaderContext);
  if (props.hidden) return null;
  const header = (
    <header className={cn(props.className, workspaceHeader && "bg-none")}>{props.children}</header>
  );
  if (workspaceHeader)
    return workspaceHeader.host ? createPortal(header, workspaceHeader.host) : null;
  return header;
}
