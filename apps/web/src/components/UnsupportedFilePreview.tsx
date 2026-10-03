import {
  isWorkspaceRelativePathSafe,
  joinWorkspaceRelativePath,
} from "@glade/shared/platform/path";

import { FileEntryIcon } from "./chat/FileEntryIcon";
import { OpenInPicker } from "./chat/OpenInPicker";
import { PanelStateMessage } from "./chat/PanelStateMessage";

export function UnsupportedFilePreview(props: { filePath: string; workspaceRoot: string | null }) {
  const openInTarget =
    props.workspaceRoot && isWorkspaceRelativePathSafe(props.filePath)
      ? joinWorkspaceRelativePath(props.workspaceRoot, props.filePath)
      : props.filePath;

  return (
    <PanelStateMessage fill="flex" className="overflow-auto">
      <div className="flex max-w-sm flex-col items-center gap-5">
        <div className="flex size-20 items-center justify-center rounded-2xl bg-muted/50">
          <FileEntryIcon pathValue={props.filePath} kind="file" className="size-12" />
        </div>
        <div className="space-y-2">
          <h2 className="text-ui-lg font-medium text-foreground">Preview unavailable</h2>
          <p className="text-ui leading-relaxed">
            Glade can&apos;t preview this file type. Open it in another app to view its contents.
          </p>
        </div>
        <OpenInPicker openInTarget={openInTarget} labelMode="always" />
      </div>
    </PanelStateMessage>
  );
}
