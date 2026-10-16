import { getRenderablePatch } from "~/lib/diffRendering";
import { FileDiffSurface } from "./chat/FileDiffView";
import { PanelStateMessage } from "./chat/PanelStateMessage";
import { PatchFileCards } from "./chat/PatchFileCards";

export function PatchFilePreview(props: {
  readonly filePath: string;
  readonly contents: string;
  readonly workspaceRoot: string | null;
  readonly truncated: boolean;
}) {
  const renderable = getRenderablePatch(props.contents, `file:${props.filePath}`);
  if (renderable === null) {
    return (
      <PanelStateMessage density="compact" fill="flex">
        <p>This patch has no changes.</p>
      </PanelStateMessage>
    );
  }
  return (
    <FileDiffSurface className="min-h-0 flex-1 overflow-auto p-2">
      {props.truncated ? (
        <p className="px-1 pb-2 text-ui-xs text-muted-foreground">
          Large patch. Only the first part is shown.
        </p>
      ) : null}
      {renderable.kind === "files" ? (
        <PatchFileCards
          key={props.contents}
          cwd={props.workspaceRoot ?? ""}
          keyPrefix={`patch:${props.filePath}`}
          files={renderable.files}
          editable={false}
          initiallyExpanded
        />
      ) : (
        <>
          <p className="px-1 pb-2 text-ui-xs text-muted-foreground">{renderable.reason}</p>
          <pre className="overflow-auto whitespace-pre-wrap break-all font-mono text-ui-xs">
            {renderable.text}
          </pre>
        </>
      )}
    </FileDiffSurface>
  );
}
