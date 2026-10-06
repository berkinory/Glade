import { parseDiffFromFile, type FileDiffMetadata } from "@pierre/diffs";
import type { ReactNode } from "react";

import { useTheme } from "~/hooks/useTheme";
import { getRenderablePatch, resolveFileDiffPath } from "~/lib/diffRendering";
import type { WorkLogToolDetails } from "../../lib/toolCallDetails";
import { useActivateDiffWorkers } from "../DiffWorkerPoolProvider";
import { FileDiffCard } from "./FileDiffView";

type ToolEdit = NonNullable<WorkLogToolDetails["edits"]>[number];

const TOOL_DIFF_SURFACE_CLASS_NAME =
  "diff-render-surface max-h-[min(24lh,48vh)] overflow-auto rounded-lg border border-border/45";

function ToolDiffFiles(props: { files: ReadonlyArray<FileDiffMetadata>; snippets?: boolean }) {
  useActivateDiffWorkers();
  const { resolvedTheme } = useTheme();
  // Tool diffs are short and live in an auto-height disclosure, which the virtualized diff surface
  // cannot measure; they render unvirtualized inside a capped scroll box instead.
  return (
    <div className={TOOL_DIFF_SURFACE_CLASS_NAME}>
      {props.files.map((file, index) => (
        <div key={`${resolveFileDiffPath(file)}:${index}`} className="diff-render-file">
          <FileDiffCard
            fileDiff={file}
            theme={resolvedTheme as "light" | "dark"}
            disableLineNumbers={props.snippets ?? false}
          />
        </div>
      ))}
    </div>
  );
}

export function ToolPatchDiff(props: { patch: string; fallback: (text: string) => ReactNode }) {
  const renderable = getRenderablePatch(props.patch, "tool-call");
  if (!renderable) return null;
  if (renderable.kind === "raw") return props.fallback(renderable.text);
  return <ToolDiffFiles files={renderable.files} />;
}

// Snippets rarely end in a newline; without one the diff flags "No newline at end of file".
function asSnippetLines(text: string | undefined): string {
  return text && !text.endsWith("\n") ? `${text}\n` : (text ?? "");
}

// Edit tools report the replaced snippet rather than the whole file, so line numbers would point at
// the snippet instead of the file and are hidden.
export function ToolEditsDiff(props: { edits: ReadonlyArray<ToolEdit> }) {
  const files = props.edits.map((edit, index) => {
    const name = edit.path ?? `edit-${index + 1}`;
    return parseDiffFromFile(
      { name, contents: asSnippetLines(edit.oldText) },
      { name, contents: asSnippetLines(edit.newText) },
    );
  });
  return <ToolDiffFiles files={files} snippets />;
}
