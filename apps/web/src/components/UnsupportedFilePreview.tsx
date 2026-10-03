import {
  isWorkspaceRelativePathSafe,
  joinWorkspaceRelativePath,
} from "@glade/shared/platform/path";

import { FileEntryIcon } from "./chat/FileEntryIcon";
import { OpenInPicker } from "./chat/OpenInPicker";
import { PanelEmptyState } from "./chat/PanelEmptyState";

export function UnsupportedFilePreview(props: { filePath: string; workspaceRoot: string | null }) {
  const openInTarget =
    props.workspaceRoot && isWorkspaceRelativePathSafe(props.filePath)
      ? joinWorkspaceRelativePath(props.workspaceRoot, props.filePath)
      : props.filePath;

  return (
    <PanelEmptyState
      fill="flex"
      icon={<FileEntryIcon pathValue={props.filePath} kind="file" className="size-12" />}
      title="Preview unavailable"
      description="Glade can't preview this file type. Open it in another app to view its contents."
    >
      <OpenInPicker openInTarget={openInTarget} labelMode="always" />
    </PanelEmptyState>
  );
}
