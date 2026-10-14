import type { ThreadId, TurnId } from "@glade/contracts/core/baseSchemas";
import { useAppSettings } from "~/appSettings";
import { resolveFileDiffPath } from "~/lib/diffRendering";
import { findPatchFile, useTurnDiff } from "./useTurnDiff";
import { useTheme } from "~/hooks/useTheme";
import { FileDiffCard, FileDiffSurface } from "./FileDiffView";
import { WorkspaceDiffFile } from "./WorkspaceDiffFile";
import { DiffLayoutToggle } from "./DiffLayoutToggle";
import { EditSourceFile } from "./EditSourceFile";
import { PanelStateMessage } from "./PanelStateMessage";
import { ShowMoreFilesButton, usePagedFiles } from "./ShowMoreFilesButton";
import { Button } from "../ui/button";

export function SourceControlTurnChanges(props: {
  threadId: ThreadId;
  turnId: TurnId;
  filePath: string | null;
  cwd: string | null;
  onOpenFile: (path: string) => void;
  onCurrentChanges: () => void;
}) {
  const { turn, count, query, patch } = useTurnDiff({
    threadId: props.threadId,
    turnId: props.turnId,
  });
  const pagedFiles = usePagedFiles(patch?.kind === "files" ? patch.files : []);
  const { resolvedTheme } = useTheme();
  const diffStyle = useAppSettings().settings.diffLayout;
  const currentChanges = (
    <Button size="sm" variant="outline" onClick={props.onCurrentChanges}>
      Current changes
    </Button>
  );
  const selectedFile = props.filePath ? findPatchFile(patch, props.filePath) : null;
  if (!query.error && turn && count !== undefined && selectedFile) {
    return (
      <WorkspaceDiffFile
        cwd={props.cwd}
        file={selectedFile}
        theme={resolvedTheme as "light" | "dark"}
        onOpenFile={props.onOpenFile}
        actions={currentChanges}
      />
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border/70 p-2">
        <span className="min-w-0 flex-1 text-ui-sm">Turn changes · {count ?? "unavailable"}</span>
        <DiffLayoutToggle />
        {currentChanges}
      </div>
      {query.error || !turn || count === undefined ? (
        <PanelStateMessage>
          {query.error?.message ?? "This turn’s checkpoint is unavailable."}
        </PanelStateMessage>
      ) : query.isPending ? (
        <PanelStateMessage loadingLabel="Loading turn changes" />
      ) : patch?.kind === "files" ? (
        <FileDiffSurface className="min-h-0 flex-1 overflow-auto p-2">
          {pagedFiles.visibleFiles.map((file) => (
            <div key={resolveFileDiffPath(file)} className="diff-render-file mb-2 rounded-md">
              <FileDiffCard
                fileDiff={file}
                diffStyle={diffStyle}
                theme={resolvedTheme as "light" | "dark"}
                renderHeaderTrailing={() => (
                  <EditSourceFile cwd={props.cwd} file={file} onOpenFile={props.onOpenFile} />
                )}
              />
            </div>
          ))}
          <ShowMoreFilesButton
            hiddenCount={pagedFiles.hiddenCount}
            onClick={pagedFiles.showMore}
            className="px-1 py-2"
          />
        </FileDiffSurface>
      ) : patch?.kind === "raw" ? (
        <pre className="overflow-auto whitespace-pre-wrap text-ui-xs">{patch.text}</pre>
      ) : (
        <PanelStateMessage>No changes in this turn.</PanelStateMessage>
      )}
    </div>
  );
}
