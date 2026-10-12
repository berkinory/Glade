import { CornerDownRightIcon, PauseFilledIcon } from "~/lib/icons";
import type { QueuedComposerTurn } from "../../composerDraftDomain";
import { cn } from "~/lib/utils";
import ChatMarkdown from "../ChatMarkdown";
import {
  ComposerStackedPanelRow,
  ComposerStackedPanelRowMain,
} from "./ComposerStackedPanelContent";
import { COMPOSER_STACKED_PANEL_DIVIDER_CLASS_NAME } from "./composerStackedPanelStyles";
import { ComposerStackedPanel } from "./ComposerStackedPanel";
import {
  COMPOSER_STACKED_PANEL_ICON_CLASS_NAME,
  COMPOSER_STACKED_PANEL_PREVIEW_MARKDOWN_CLASS_NAME,
} from "./composerStackedPanelStyles";
import { QueuedComposerActions } from "./QueuedComposerActions";
import { Button } from "../ui/button";
import type { QueuedComposerPause, QueuedComposerPauseReason } from "./ComposerQueuedHeader.logic";

const PAUSE_DETAIL_BY_REASON: Record<QueuedComposerPauseReason, string> = {
  stopped: "Paused after you stopped the turn",
  error: "Paused after an error",
  "usage-limit": "Paused at a usage limit",
};

function QueuedComposerPausedNotice({
  pause,
  onResume,
  onEdit,
}: {
  pause: QueuedComposerPause;
  onResume: () => void;
  onEdit: () => void;
}) {
  return (
    <ComposerStackedPanelRow compact role="status">
      <ComposerStackedPanelRowMain>
        <PauseFilledIcon
          aria-hidden
          className={cn(
            COMPOSER_STACKED_PANEL_ICON_CLASS_NAME,
            pause.reason !== "stopped" && "text-warning",
          )}
        />
        <span className="min-w-0 truncate text-ui-sm text-muted-foreground">
          <span className="font-medium text-foreground">Queue paused</span>
          <span aria-hidden> · </span>
          {PAUSE_DETAIL_BY_REASON[pause.reason]}
        </span>
      </ComposerStackedPanelRowMain>
      <div className="flex shrink-0 items-center gap-1">
        <Button variant="subtle" size="chip" onClick={onResume}>
          Resume
        </Button>
        <Button variant="ghost" size="chip" onClick={onEdit}>
          Edit
        </Button>
      </div>
    </ComposerStackedPanelRow>
  );
}
function firstNonEmptyLine(value: string): string {
  return (
    value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0)
      ?.trim() ?? ""
  );
}
function compactQueuedComposerPreviewMarkdown(value: string): string {
  const firstLine = firstNonEmptyLine(value);
  if (firstLine.length === 0) {
    return "Queued follow-up";
  }
  if (/^(?:`{3,}|~{3,})/.test(firstLine)) {
    return "Code block";
  }
  const normalized = firstLine
    .replace(/^#{1,6}\s+/, "")
    .replace(/^>\s?/, "")
    .replace(/^- \[[ xX]\]\s+/, "")
    .replace(/^[-*+]\s+/, "")
    .replace(/^\d+[.)]\s+/, "")
    .trim();
  return normalized.length > 0 ? normalized : "Queued follow-up";
}
interface ComposerQueuedHeaderProps {
  queuedTurns: QueuedComposerTurn[];
  onSteer: (queuedTurn: QueuedComposerTurn) => void;
  onRemove: (queuedTurnId: string) => void;
  onEdit: (queuedTurn: QueuedComposerTurn) => void;
  pause: QueuedComposerPause | null;
  onResume: () => void;
  onEditPaused: () => void;
  cwd?: string | undefined;
  attachedToPrevious?: boolean;
}
export const ComposerQueuedHeader = function ComposerQueuedHeader({
  queuedTurns,
  onSteer,
  onRemove,
  onEdit,
  pause,
  onResume,
  onEditPaused,
  cwd,
  attachedToPrevious: attachedToPreviousProp,
}: ComposerQueuedHeaderProps) {
  const attachedToPrevious = attachedToPreviousProp ?? false;
  if (queuedTurns.length === 0) {
    return null;
  }
  return (
    <ComposerStackedPanel attachedToPrevious={attachedToPrevious} className="flex flex-col">
      {pause ? (
        <QueuedComposerPausedNotice pause={pause} onResume={onResume} onEdit={onEditPaused} />
      ) : null}
      {queuedTurns.map((queuedTurn, queuedTurnIndex) => (
        <ComposerStackedPanelRow
          key={queuedTurn.id}
          compact
          data-testid="queued-follow-up-row"
          className={cn(
            (queuedTurnIndex > 0 || pause) && COMPOSER_STACKED_PANEL_DIVIDER_CLASS_NAME,
          )}
        >
          <ComposerStackedPanelRowMain>
            <CornerDownRightIcon className={COMPOSER_STACKED_PANEL_ICON_CLASS_NAME} />
            <ChatMarkdown
              text={compactQueuedComposerPreviewMarkdown(queuedTurn.previewText)}
              cwd={cwd}
              isStreaming={false}
              className={COMPOSER_STACKED_PANEL_PREVIEW_MARKDOWN_CLASS_NAME}
            />
          </ComposerStackedPanelRowMain>
          <QueuedComposerActions
            queuedTurn={queuedTurn}
            onSteer={onSteer}
            onRemove={onRemove}
            onEdit={onEdit}
          />
        </ComposerStackedPanelRow>
      ))}
    </ComposerStackedPanel>
  );
};
