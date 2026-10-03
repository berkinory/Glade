import { useQuery } from "@tanstack/react-query";
import { useTheme } from "~/hooks/useTheme";
import { getRenderablePatch } from "~/lib/diffRendering";
import { gitWorkingTreeDiffQueryOptions } from "~/lib/gitQueryOptions";
import { Button } from "../ui/button";
import { WorkspaceDiffFile } from "./WorkspaceDiffFile";
import { GitMediaPreview, isGitMediaPath } from "./GitMediaPreview";
import { PanelStateMessage } from "./PanelStateMessage";

export function WorkspaceGitDiff(props: {
  cwd: string;
  filePath: string;
  scope: "staged" | "unstaged";
  onOpenFile: (path: string) => void;
}) {
  const { resolvedTheme } = useTheme();
  const media = isGitMediaPath(props.filePath);
  const query = useQuery(
    gitWorkingTreeDiffQueryOptions({
      cwd: props.cwd,
      scope: props.scope,
      filePath: props.filePath,
      enabled: !media,
    }),
  );
  if (media)
    return (
      <GitMediaPreview
        cwd={props.cwd}
        path={props.filePath}
        revision={props.scope === "staged" ? "index" : "workingTree"}
      />
    );
  if (query.isPending) return <PanelStateMessage loadingLabel="Loading diff" />;
  if (query.isError)
    return (
      <PanelStateMessage>
        Could not load this file’s diff.{" "}
        <Button size="sm" variant="outline" onClick={() => void query.refetch()}>
          Retry
        </Button>
      </PanelStateMessage>
    );
  const renderable = getRenderablePatch(
    query.data.patch,
    `workspace:${props.scope}:${props.filePath}`,
  );
  if (renderable?.kind === "files" && renderable.files[0])
    return (
      <WorkspaceDiffFile
        cwd={props.cwd}
        file={renderable.files[0]}
        truncated={query.data.truncated}
        theme={resolvedTheme as "light" | "dark"}
        onOpenFile={props.onOpenFile}
      />
    );
  return renderable?.kind === "raw" ? (
    <pre className="h-full overflow-auto whitespace-pre-wrap break-all font-mono text-ui-xs">
      {renderable.text}
    </pre>
  ) : (
    <PanelStateMessage>No diff to show.</PanelStateMessage>
  );
}
