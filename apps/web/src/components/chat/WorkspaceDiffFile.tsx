import type { FileDiffMetadata } from "@pierre/diffs/react";
import { useState, type ReactNode } from "react";
import { DiffLayoutToggle } from "./DiffLayoutToggle";
import { FileDiffCard, FileDiffSurface } from "./FileDiffView";
import { EditSourceFile } from "./EditSourceFile";
import { WorkspaceFilePreviewHeader } from "./WorkspaceFilePreviewHeader";
import { resolveFileDiffPath } from "~/lib/diffRendering";

export function WorkspaceDiffFile(props: {
  cwd: string | null;
  actions?: ReactNode;
  file: FileDiffMetadata;
  theme: "light" | "dark";
  truncated?: boolean;
  onOpenFile: (path: string) => void;
}) {
  const [style, setStyle] = useState<"unified" | "split">("unified");
  return (
    <div className="flex h-full min-h-0 flex-col">
      <WorkspaceFilePreviewHeader
        file={{
          path: resolveFileDiffPath(props.file),
          workspaceRoot: props.cwd,
          truncated: props.truncated ?? false,
        }}
        actions={
          <>
            <DiffLayoutToggle value={style} onChange={setStyle} />
            {props.actions}
            <EditSourceFile cwd={props.cwd} file={props.file} onOpenFile={props.onOpenFile} />
          </>
        }
      />
      <FileDiffSurface className="min-h-0 flex-1 overflow-auto">
        <FileDiffCard fileDiff={props.file} theme={props.theme} diffStyle={style} hideHeader />
      </FileDiffSurface>
    </div>
  );
}
