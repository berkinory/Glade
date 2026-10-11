import { useQuery } from "@tanstack/react-query";
import { getRenderablePatch } from "~/lib/diffRendering";
import { gitPullRequestDiffQueryOptions } from "~/lib/gitQueryOptions";
import { FileDiffSurface } from "../chat/FileDiffView";
import { PanelStateMessage } from "../chat/PanelStateMessage";
import { PatchFileCards } from "../chat/PatchFileCards";
import { Button } from "../ui/button";

export function PullRequestFiles(props: {
  cwd: string;
  number: number;
  diffStyle: "unified" | "split";
  onOpenFile: (path: string) => void;
}) {
  const diff = useQuery(gitPullRequestDiffQueryOptions(props.cwd, props.number, true));
  const renderable = getRenderablePatch(
    diff.data?.patch,
    `pull-request:${props.cwd}:${props.number}`,
  );
  if (diff.isPending) return <PanelStateMessage loadingLabel="Loading changes" />;
  if (diff.isError)
    return (
      <PanelStateMessage>
        <div className="flex flex-col items-center gap-2">
          <span>Could not load the changes.</span>
          <Button size="sm" variant="outline" onClick={() => void diff.refetch()}>
            Retry
          </Button>
        </div>
      </PanelStateMessage>
    );
  return (
    <FileDiffSurface className="min-h-0 flex-1 overflow-auto p-2">
      {diff.data.truncated ? (
        <p className="px-1 pb-2 text-ui-xs text-muted-foreground">
          Large pull request. Diff is partial.
        </p>
      ) : null}
      {renderable?.kind === "files" ? (
        <PatchFileCards
          cwd={props.cwd}
          keyPrefix={`pr-${props.number}`}
          files={renderable.files}
          editable={false}
          diffStyle={props.diffStyle}
          onOpenFile={props.onOpenFile}
        />
      ) : renderable?.kind === "raw" ? (
        <pre className="overflow-auto whitespace-pre-wrap break-all font-mono text-ui-xs">
          {renderable.text}
        </pre>
      ) : (
        <PanelStateMessage>No file changes.</PanelStateMessage>
      )}
    </FileDiffSurface>
  );
}
