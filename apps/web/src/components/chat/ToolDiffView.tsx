import { parseDiffFromFile, type FileDiffMetadata } from "@pierre/diffs";
import type { ThreadId, TurnId } from "@glade/contracts/core/baseSchemas";
import type { ReactNode } from "react";

import { useTheme } from "~/hooks/useTheme";
import { getRenderablePatch, resolveFileDiffPath } from "~/lib/diffRendering";
import type { WorkLogToolDetails } from "../../lib/toolCallDetails";
import { useActivateDiffWorkers } from "../DiffWorkerPoolProvider";
import { FileDiffCard } from "./FileDiffView";
import { ShowMoreFilesButton, usePagedFiles } from "./ShowMoreFilesButton";
import { findPatchFile, useTurnDiff } from "./useTurnDiff";

type ToolEdit = NonNullable<WorkLogToolDetails["edits"]>[number];

const TOOL_DIFF_SURFACE_CLASS_NAME =
  "diff-render-surface max-h-[min(24lh,48vh)] overflow-auto rounded-lg border border-border/45";

function ToolDiffFiles(props: { files: ReadonlyArray<FileDiffMetadata>; snippets?: boolean }) {
  const workersSettled = useActivateDiffWorkers();
  const { resolvedTheme } = useTheme();
  const pagedFiles = usePagedFiles(props.files);
  if (!workersSettled) {
    return <div className={TOOL_DIFF_SURFACE_CLASS_NAME} />;
  }
  // Tool diffs are short and live in an auto-height disclosure, which the virtualized diff surface
  // cannot measure; they render unvirtualized inside a capped scroll box instead.
  return (
    <div className={TOOL_DIFF_SURFACE_CLASS_NAME}>
      {pagedFiles.visibleFiles.map((file, index) => (
        <div key={`${resolveFileDiffPath(file)}:${index}`} className="diff-render-file">
          <FileDiffCard
            fileDiff={file}
            theme={resolvedTheme as "light" | "dark"}
            disableLineNumbers={props.snippets ?? false}
          />
        </div>
      ))}
      <ShowMoreFilesButton
        hiddenCount={pagedFiles.hiddenCount}
        onClick={pagedFiles.showMore}
        className="px-2 py-1.5"
      />
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

// A file's part of its turn's diff, for an edit whose tool reported no diff of its own.
export function ToolTurnFileDiff(props: { threadId: ThreadId; turnId: TurnId; filePath: string }) {
  const { count, query, patch } = useTurnDiff({ threadId: props.threadId, turnId: props.turnId });
  const file = findPatchFile(patch, props.filePath);
  if (file) return <ToolDiffFiles files={[file]} />;
  const loading = count !== undefined && query.isPending;
  return (
    <p className="text-ui-xs text-muted-foreground">
      {loading ? "Loading the change…" : "The change for this file is not available."}
    </p>
  );
}
