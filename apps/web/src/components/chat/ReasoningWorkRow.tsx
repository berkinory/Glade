import { formatClockDuration } from "../../session-logic";
import type { WorkLogEntry } from "../../workLog.types";
import { Brain03Icon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import ChatMarkdown from "../ChatMarkdown";
import { getChatTranscriptTextStyle } from "./chatTypography";
import type { ExpandedImagePreview } from "./ExpandedImagePreview";
import { ToolDetailsDisclosure } from "./TimelineWorkEntryDetails";
import {
  WORK_ROW_BLOCK_CLASS_NAME,
  WORK_ROW_GAP_CLASS_NAME,
  WORK_ROW_ICON_CLASS_NAME,
  WORK_ROW_ICON_SLOT_CLASS_NAME,
  WORK_ROW_LINE_CLASS_NAME,
  WORK_ROW_MUTED_HOVER_TONE,
} from "./workRowStyles";

function reasoningLabel(reasoning: NonNullable<WorkLogEntry["reasoning"]>): string {
  if (reasoning.live) return "Thinking";
  if (reasoning.durationMs === undefined) return "Thought";
  const roundedMs = Math.max(1_000, Math.round(reasoning.durationMs / 1_000) * 1_000);
  return `Thought for ${formatClockDuration(roundedMs)}`;
}

export function ReasoningWorkRow(props: {
  entry: WorkLogEntry;
  reasoning: NonNullable<WorkLogEntry["reasoning"]>;
  fontSizePx: number;
  markdownCwd: string | undefined;
  onImageExpand: (preview: ExpandedImagePreview) => void;
}) {
  const { entry, reasoning, fontSizePx } = props;
  const typographyStyle = getChatTranscriptTextStyle(fontSizePx);
  const summary = (
    <>
      <span className={cn(WORK_ROW_ICON_SLOT_CLASS_NAME, WORK_ROW_MUTED_HOVER_TONE["tool-row"])}>
        <Brain03Icon className={WORK_ROW_ICON_CLASS_NAME} />
      </span>
      <p
        className={cn(WORK_ROW_LINE_CLASS_NAME, WORK_ROW_MUTED_HOVER_TONE["tool-row"])}
        style={{ fontSize: `${fontSizePx}px` }}
      >
        <span className={reasoning.live ? "work-text-shimmer" : undefined}>
          {reasoningLabel(reasoning)}
        </span>
      </p>
    </>
  );
  return (
    <div className={WORK_ROW_BLOCK_CLASS_NAME} data-reasoning-row="true">
      {entry.detail ? (
        <ToolDetailsDisclosure
          detailContent={
            <div
              className="max-h-[min(12lh,32vh)] overflow-y-auto overscroll-contain pr-2"
              style={typographyStyle}
            >
              <ChatMarkdown
                text={entry.detail}
                cwd={props.markdownCwd}
                style={typographyStyle}
                className="text-chat leading-relaxed text-muted-foreground"
                onImageExpand={props.onImageExpand}
              />
            </div>
          }
        >
          {summary}
        </ToolDetailsDisclosure>
      ) : (
        <div className={cn("flex items-center", WORK_ROW_GAP_CLASS_NAME)}>{summary}</div>
      )}
    </div>
  );
}
