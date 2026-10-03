import { useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { WorkspaceHeaderContext } from "./WorkspaceHeaderContext";

export function ChatSurfaceHeader(props: {
  readonly hidden?: boolean;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  const workspaceHeader = useContext(WorkspaceHeaderContext);
  if (props.hidden) return null;
  const header = <header className={props.className}>{props.children}</header>;
  if (workspaceHeader)
    return workspaceHeader.host ? createPortal(header, workspaceHeader.host) : null;
  return header;
}
