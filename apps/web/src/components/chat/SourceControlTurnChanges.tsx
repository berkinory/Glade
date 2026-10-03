import type { ThreadId, TurnId } from "@glade/contracts/core/baseSchemas";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useStore } from "~/store";
import { createThreadSelector } from "~/storeSelectors";
import { inferCheckpointTurnCountByTurnId } from "~/session-logic";
import { checkpointDiffQueryOptions } from "~/lib/providerReactQuery";
import { getRenderablePatch, resolveFileDiffPath } from "~/lib/diffRendering";
import { useTheme } from "~/hooks/useTheme";
import { FileDiffCard, FileDiffSurface } from "./FileDiffView";
import { WorkspaceDiffFile } from "./WorkspaceDiffFile";
import { DiffLayoutToggle } from "./DiffLayoutToggle";
import { EditSourceFile } from "./EditSourceFile";
import { PanelStateMessage } from "./PanelStateMessage";
import { Button } from "../ui/button";

export function SourceControlTurnChanges(props: {
  threadId: ThreadId;
  turnId: TurnId;
  filePath: string | null;
  cwd: string | null;
  onOpenFile: (path: string) => void;
  onCurrentChanges: () => void;
}) {
  const thread = useStore(useMemo(() => createThreadSelector(props.threadId), [props.threadId]));
  const summaries = thread?.turnDiffSummaries ?? [];
  const turn = summaries.find((summary) => summary.turnId === props.turnId);
  const count =
    turn?.checkpointTurnCount ?? inferCheckpointTurnCountByTurnId(summaries)[props.turnId];
  const query = useQuery(
    checkpointDiffQueryOptions({
      threadId: props.threadId,
      fromTurnCount: count === undefined ? null : Math.max(0, count - 1),
      toTurnCount: count ?? null,
      ignoreWhitespace: false,
      cacheScope: `turn:${props.turnId}`,
      live: false,
      enabled: count !== undefined,
    }),
  );
  const patch = getRenderablePatch(query.data?.diff, `turn:${props.turnId}`);
  const { resolvedTheme } = useTheme();
  const [diffStyle, setDiffStyle] = useState<"unified" | "split">("unified");
  const currentChanges = (
    <Button size="sm" variant="outline" onClick={props.onCurrentChanges}>
      Current changes
    </Button>
  );
  const selectedFile =
    patch?.kind === "files"
      ? patch.files.find((file) => resolveFileDiffPath(file) === props.filePath)
      : null;
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
        <DiffLayoutToggle value={diffStyle} onChange={setDiffStyle} />
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
          {patch.files.map((file) => (
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
        </FileDiffSurface>
      ) : patch?.kind === "raw" ? (
        <pre className="overflow-auto whitespace-pre-wrap text-ui-xs">{patch.text}</pre>
      ) : (
        <PanelStateMessage>No changes in this turn.</PanelStateMessage>
      )}
    </div>
  );
}
