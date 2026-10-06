import { isWorkspaceRelativePathSafe } from "@glade/shared/platform/path";
import { isRecord } from "@glade/shared/transport/payloadValues";

export const WORKSPACE_RESOURCE_DRAG_TYPE = "application/x-glade-workspace-resource";
export type WorkspaceResourceDrag =
  | { kind: "tab"; threadId: string; tabId: string }
  | { kind: "file"; workspaceRoot: string; path: string };

export function writeWorkspaceResourceDrag(
  data: DataTransfer,
  resource: WorkspaceResourceDrag,
): void {
  data.setData(WORKSPACE_RESOURCE_DRAG_TYPE, JSON.stringify(resource));
}
export function readWorkspaceResourceDrag(data: DataTransfer): WorkspaceResourceDrag | null {
  const raw = data.getData(WORKSPACE_RESOURCE_DRAG_TYPE);
  if (!raw || raw.length > 8_192) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  if (value.kind === "tab" && typeof value.threadId === "string" && typeof value.tabId === "string")
    return { kind: "tab", threadId: value.threadId, tabId: value.tabId };
  if (
    value.kind === "file" &&
    typeof value.workspaceRoot === "string" &&
    typeof value.path === "string" &&
    isWorkspaceRelativePathSafe(value.path)
  )
    return { kind: "file", workspaceRoot: value.workspaceRoot, path: value.path };
  return null;
}
