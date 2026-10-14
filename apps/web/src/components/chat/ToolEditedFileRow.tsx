import type { TurnId } from "@glade/contracts/core/baseSchemas";
import { lazy, Suspense } from "react";
import { resolveDiffEntryByPath } from "~/lib/diffRendering";
import { PencilEdit02Icon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import { openWorkspaceFileReference, useWorkspaceFileOpener } from "~/lib/workspaceFileOpener";
import { useStore } from "~/store";
import type { WorkLogLiveActivity, WorkLogToolKind } from "~/workLog.types";
import type { WorkLogToolDetails } from "../../lib/toolCallDetails";
import { useOptionalChatThreadId } from "./ChatThreadContext";
import { DiffStatLabel } from "./DiffStatLabel";
import { FileNameChip } from "./FileNameChip";
import { hasToolCallDetailsContent } from "./ToolCallDetailsDialog.logic";
import { ToolDetailsDisclosure } from "./TimelineWorkEntryDetails";
import {
  WORK_ROW_GAP_CLASS_NAME,
  WORK_ROW_ICON_CLASS_NAME,
  WORK_ROW_ICON_SLOT_CLASS_NAME,
  WORK_ROW_MUTED_HOVER_TONE,
} from "./workRowStyles";

// The diff renderer pulls in its worker pool, so it loads only once a row is opened.
const ToolTurnFileDiff = lazy(() =>
  import("./ToolDiffView").then((module) => ({ default: module.ToolTurnFileDiff })),
);

const EDITED_ROW_CLASS_NAME = cn(
  "group/file-row flex w-full max-w-full items-center text-left",
  WORK_ROW_GAP_CLASS_NAME,
  "cursor-pointer focus-visible:outline-none disabled:cursor-default",
);

/**
 * One file a tool row says an edit changed, whichever provider made it. Opening the row shows that change: the
 * tool's own diff when it reported one, otherwise the file's part of its turn's diff. With neither,
 * the row opens the file. Its file chip always opens the file.
 */
export function ToolEditedFileRow(props: {
  filePath: string;
  additions: number | undefined;
  deletions: number | undefined;
  fontSizePx: number;
  turnId: TurnId | undefined;
  toolDetails?: WorkLogToolDetails | undefined;
  liveActivity?: WorkLogLiveActivity | undefined;
  toolKind?: WorkLogToolKind | undefined;
}) {
  const threadId = useOptionalChatThreadId();
  const opener = useWorkspaceFileOpener();
  const turnFile = useStore((state) => {
    const summary =
      threadId && props.turnId
        ? state.turnDiffSummaryByThreadId?.[threadId]?.[props.turnId]
        : undefined;
    return summary
      ? resolveDiffEntryByPath(
          new Map(summary.files.map((file) => [file.path, file])),
          props.filePath,
        )
      : undefined;
  });
  const openFile = opener ? () => openWorkspaceFileReference(opener, props.filePath) : undefined;
  const turnStatChanged = (turnFile?.additions ?? 0) + (turnFile?.deletions ?? 0) > 0;
  const content = (
    <EditedFileRowContent
      filePath={props.filePath}
      additions={turnStatChanged ? turnFile?.additions : props.additions}
      deletions={turnStatChanged ? turnFile?.deletions : props.deletions}
      fontSizePx={props.fontSizePx}
      onOpenFile={openFile}
    />
  );
  if (hasToolCallDetailsContent(props.toolDetails, props.liveActivity, props.toolKind)) {
    return (
      <ToolDetailsDisclosure
        details={props.toolDetails}
        activity={props.liveActivity}
        summaryClassName={EDITED_ROW_CLASS_NAME}
        dataFileChangeRow
      >
        {content}
      </ToolDetailsDisclosure>
    );
  }
  if (threadId && props.turnId && turnFile) {
    return (
      <ToolDetailsDisclosure
        summaryClassName={EDITED_ROW_CLASS_NAME}
        dataFileChangeRow
        detailContent={
          <Suspense fallback={null}>
            <ToolTurnFileDiff threadId={threadId} turnId={props.turnId} filePath={props.filePath} />
          </Suspense>
        }
      >
        {content}
      </ToolDetailsDisclosure>
    );
  }
  return (
    <button
      type="button"
      data-file-change-row="true"
      className={EDITED_ROW_CLASS_NAME}
      title={props.filePath}
      disabled={!openFile}
      onClick={openFile}
    >
      {content}
    </button>
  );
}

function EditedFileRowContent(props: {
  filePath: string;
  additions: number | undefined;
  deletions: number | undefined;
  fontSizePx: number;
  onOpenFile: (() => void) | undefined;
}) {
  const { filePath, additions, deletions, fontSizePx } = props;
  const hasStat = (additions ?? 0) + (deletions ?? 0) > 0;
  return (
    <>
      <span
        className={cn(WORK_ROW_ICON_SLOT_CLASS_NAME, WORK_ROW_MUTED_HOVER_TONE["file-row"])}
        data-tool-icon="edit"
      >
        <PencilEdit02Icon className={WORK_ROW_ICON_CLASS_NAME} />
      </span>
      <span
        className={cn("font-system-ui shrink-0", WORK_ROW_MUTED_HOVER_TONE["file-row"])}
        style={{
          fontSize: `${fontSizePx}px`,
        }}
      >
        Edited
      </span>
      <span
        className={cn(
          "font-system-ui min-w-0 max-w-[28rem]",
          WORK_ROW_MUTED_HOVER_TONE["file-row"],
        )}
        style={{
          fontSize: `${fontSizePx}px`,
        }}
      >
        <FileNameChip path={filePath} onOpen={props.onOpenFile} />
      </span>
      {hasStat ? (
        <span
          className="font-system-ui shrink-0 tabular-nums whitespace-nowrap"
          style={{
            fontSize: `${fontSizePx}px`,
          }}
        >
          <DiffStatLabel additions={additions ?? 0} deletions={deletions ?? 0} />
        </span>
      ) : null}
    </>
  );
}
