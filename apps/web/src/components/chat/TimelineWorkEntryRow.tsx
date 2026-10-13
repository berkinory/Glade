import { subagentToolHeading } from "./SubagentToolPresentation";
import { SubagentRunCard } from "./SubagentRunCard";
import { Spinner } from "../ui/spinner";
import {
  WORK_ROW_BLOCK_CLASS_NAME,
  WORK_ROW_GAP_CLASS_NAME,
  WORK_ROW_ICON_CLASS_NAME,
  WORK_ROW_ICON_SLOT_CLASS_NAME,
  WORK_ROW_LINE_CLASS_NAME,
  WORK_ROW_MUTED_HOVER_TONE,
} from "./workRowStyles";
import { FileNameChip } from "./FileNameChip";
import { toolInputFilePath } from "./ToolIoDetails.logic";
import { resolveMcpToolIcon } from "~/lib/mcpToolIcon";
import { GitHubIcon } from "~/lib/brandIcons";
import {
  CheckmarkCircle02Icon,
  BookOpen01Icon,
  BotIcon,
  Brain03Icon,
  InfoIcon,
  File02Icon,
  AlertCircleIcon,
  HelpCircleIcon,
  FilterIcon,
  ViewIcon,
  Globe02Icon,
  CursorInWindowIcon,
  ToolsIcon,
  FlowIcon,
  HistoryIcon,
  McpServerIcon,
  PencilEdit02Icon,
  SearchIcon,
  BlocksIcon,
  ComputerTerminal01Icon,
  Image01Icon,
  ChartAreaIcon,
  FolderIcon,
} from "~/lib/icons";
import type { IconComponent } from "~/lib/iconComponent";
import { SubagentReplyNotice } from "./SubagentReplyNotice";
import { ProviderTransitionDivider } from "./ProviderTransitionDivider";
import type { TimestampFormat } from "../../appSettings";
import type { AgentActivityDetail } from "./agentActivity.logic";
import { AgentActivityDetails } from "./AgentActivityDetails";
import { hasToolCallDetailsContent } from "./ToolCallDetailsDialog.logic";
import type { TurnId } from "@glade/contracts/core/baseSchemas";
import { createElement, memo, useMemo, type ReactElement } from "react";
import { basenameOfPath } from "~/file-icons";
import {
  AgentActivityOpenSurface,
  MonitorEventDetails,
  ProviderContextLifecycleDetails,
  ToolDetailsDisclosure,
} from "./TimelineWorkEntryDetails";
import { describeLinkChip } from "~/lib/linkChips";
import { cn } from "~/lib/utils";
import {
  isFileChangeWorkLogEntry,
  type WorkLogBackgroundTask,
  type WorkLogEntry,
} from "../../workLog.types";
import { formatClockDuration } from "../../session-logic";
import { isStatusOnlyCommandWorkEntry, isPlainRuntimeNoticeWorkEntry } from "./agentActivity.logic";
import { ReasoningWorkRow } from "./ReasoningWorkRow";
import { RequestRetryRow } from "./RequestRetryRow";
import { DiffStatLabel } from "./DiffStatLabel";
import { type ExpandedImagePreview } from "./ExpandedImagePreview";
import { LinkChipIcon } from "../LinkChipIcon";
import { normalizeCompactToolLabel } from "./MessagesTimeline.logic.rowTypes";
import { GladeLogo } from "../GladeLogo";
import { fileDiffStatsByPath, resolveFileDiffStatByChangedPath } from "~/lib/diffRendering";
import {
  extractToolArgumentField,
  isPrefixedToolArgumentSummary,
} from "../../lib/toolArgumentSummary";
import {
  deriveFriendlyCommandTarget,
  resolveCommandVisualKind,
} from "../../lib/toolCallLabel.commands";
import {
  deriveGladeMcpToolTitle,
  isGladeVisualToolCall,
  sanitizeGladeMcpToolPreview,
} from "../../lib/toolCallLabel.descriptors";
import type { GladeMcpToolStatus } from "../../lib/gatewayToolCall";
import {
  extractWebFetchUrl,
  normalizeToolTextForComparison,
} from "../../lib/toolCallLabel.presentations";
import { formatLiveActivityMeta, useLiveActivityNow } from "../../lib/liveActivityPresentation";
import { openWorkspaceFileReference, useWorkspaceFileOpener } from "../../lib/workspaceFileOpener";
const EMPTY_FILE_DIFF_STATS: ReadonlyMap<
  string,
  {
    additions: number;
    deletions: number;
  }
> = new Map();
type TimelineWorkEntry = WorkLogEntry;
const GladeToolIcon: IconComponent = ({ className, ...props }) => (
  <GladeLogo {...props} className={cn("text-current", className)} />
);
function workToneIcon(tone: TimelineWorkEntry["tone"]): {
  icon: IconComponent;
  className: string;
} {
  if (tone === "error") {
    return {
      icon: AlertCircleIcon,
      className: "text-muted-foreground/50",
    };
  }
  if (tone === "thinking") {
    return {
      icon: Brain03Icon,
      className: "text-muted-foreground/40",
    };
  }
  if (tone === "info") {
    return {
      icon: InfoIcon,
      className: "text-muted-foreground/50",
    };
  }
  return {
    icon: BookOpen01Icon,
    className: "text-muted-foreground/45",
  };
}
function extractFilePathFromDetail(detail: string): string | null {
  const plainPathMatch = /^(.+?\.[A-Za-z0-9][A-Za-z0-9._-]*)(?::\d+)?(?::\d+)?$/u.exec(
    detail.trim(),
  );
  if (plainPathMatch?.[1]?.includes("/")) {
    return plainPathMatch[1].trim();
  }
  return extractToolArgumentField(detail, ["file_path", "filePath", "path", "filename"], {
    fallbackScan: "whenUnparsed",
  });
}
// Gateway browser and computer rows carry their finished heading and preview from the work log.
function ownsToolTitle(workEntry: TimelineWorkEntry): boolean {
  return workEntry.toolKind === "browser" || workEntry.toolKind === "computer";
}
function workEntryPreview(workEntry: TimelineWorkEntry): string | null {
  if (workEntry.monitorNotification) return null;
  if (workEntry.itemType === "collab_agent_tool_call") {
    const task = workEntry.subagentAction?.prompt ?? workEntry.preview ?? workEntry.detail;
    return (
      task
        ?.split("\n")
        .find((line) => line.trim())
        ?.trim() ?? null
    );
  }
  if (ownsToolTitle(workEntry)) return workEntry.preview ?? null;
  const isFileRelated = workEntry.toolKind === "read" || workEntry.toolKind === "edit";
  if (workEntry.itemType === "command_execution" || workEntry.command || workEntry.rawCommand) {
    const command = workEntry.command ?? workEntry.rawCommand;
    if (command) return deriveFriendlyCommandTarget(command);
  }
  if (workEntry.preview) return workEntry.preview;
  if (workEntry.changedFiles && workEntry.changedFiles.length > 0) {
    const names = workEntry.changedFiles.map((p) => basenameOfPath(p));
    if (names.length === 1) return names[0]!;
    return `${names.length} files`;
  }
  if (workEntry.detail) {
    const filePath = extractFilePathFromDetail(workEntry.detail);
    if (filePath) return basenameOfPath(filePath);
    if (isFileRelated) return null;
    const trimmedDetail = workEntry.detail.trim();
    if (trimmedDetail.startsWith("{") || trimmedDetail.startsWith("[")) return null;
    if (toolWorkEntryStatus(workEntry) !== "failed" && isPrefixedToolArgumentSummary(trimmedDetail))
      return null;
    const readLinesMatch = /^Read\s+(\d+\s+lines?)$/i.exec(trimmedDetail);
    if (readLinesMatch?.[1]) return readLinesMatch[1];
    return trimmedDetail;
  }
  return null;
}
function commandWorkEntryIcon(workEntry: TimelineWorkEntry): IconComponent {
  const command = workEntry.command ?? workEntry.rawCommand;
  switch (command ? resolveCommandVisualKind(command) : "terminal") {
    case "inspect":
      return SearchIcon;
    case "git":
    case "github":
      return GitHubIcon;
    case "terminal":
      return ComputerTerminal01Icon;
  }
}
function workEntryIcon(workEntry: TimelineWorkEntry): IconComponent {
  if (workEntry.activityKind === "user-input.requested") return HelpCircleIcon;
  if (workEntry.activityKind === "user-input.resolved") return CheckmarkCircle02Icon;
  if (workEntry.activityKind === "context-compaction") return FilterIcon;
  if (workEntry.monitorNotification) {
    return workEntry.monitorNotification.outcome === "failed" ? AlertCircleIcon : ViewIcon;
  }
  if (workEntry.providerContextLifecycle) {
    return workEntry.providerContextLifecycle.nativeHistory === "unavailable"
      ? AlertCircleIcon
      : HistoryIcon;
  }
  switch (workEntry.toolKind) {
    case "command":
      return commandWorkEntryIcon(workEntry);
    case "read":
      return File02Icon;
    case "list":
      return FolderIcon;
    case "search":
      return SearchIcon;
    case "edit":
      return PencilEdit02Icon;
    case "fetch":
    case "web_search":
    case "browser":
      return Globe02Icon;
    case "computer":
      return CursorInWindowIcon;
    case "agent":
      return BotIcon;
    case "image_view":
      return ViewIcon;
    case "image_generation":
      return Image01Icon;
    case "mcp":
      return BlocksIcon;
    case "tool":
      return workEntry.requestKind === "tool" ? FlowIcon : ToolsIcon;
  }
  return workToneIcon(workEntry.tone).icon;
}
// A fetched page's favicon stands in for generic fetch tools, but a recognised MCP brand stays visible.
export function workEntryLinkIconUrl(workEntry: TimelineWorkEntry): string | null {
  return resolveMcpToolIcon(workEntry) ? null : extractWebFetchUrl(workEntry);
}
export function renderWorkEntryIcon(Icon: IconComponent, className: string): ReactElement {
  return createElement(Icon, {
    className,
  });
}
export function workEntryLeftIcon(
  workEntry: TimelineWorkEntry,
  classification = classifyWorkEntryTool(workEntry),
): IconComponent {
  if (classification.isVisual) return ChartAreaIcon;
  if (classification.mcpIcon) return classification.mcpIcon;
  if (workEntry.toolKind === "browser") return Globe02Icon;
  if (workEntry.toolKind === "computer") return CursorInWindowIcon;
  if (classification.gladeTitle !== null) return GladeToolIcon;
  if (workEntry.itemType === "mcp_tool_call") return McpServerIcon;
  return workEntryIcon(workEntry);
}
function toolWorkEntryStatus(workEntry: TimelineWorkEntry): GladeMcpToolStatus {
  if (workEntry.toolStatus) return workEntry.toolStatus;
  return workEntry.activityKind !== undefined && workEntry.activityKind !== "tool.completed"
    ? "running"
    : "completed";
}
function classifyWorkEntryTool(workEntry: TimelineWorkEntry) {
  const status = toolWorkEntryStatus(workEntry);
  const titleInput = {
    toolName: workEntry.toolName,
    title: workEntry.toolTitle,
    fallbackLabel: workEntry.label,
    status,
  };
  const mcpIcon = resolveMcpToolIcon(workEntry);
  return {
    status,
    mcpIcon,
    isGitHub: mcpIcon === GitHubIcon,
    isVisual: isGladeVisualToolCall(titleInput),
    // An approval row names the tool it asks about; the tool's own heading would say it ran.
    gladeTitle: workEntry.activityKind?.startsWith("approval.")
      ? null
      : deriveGladeMcpToolTitle(titleInput),
  };
}
function formatBackgroundTaskMeta(task: WorkLogBackgroundTask): string {
  const elapsed =
    task.settledAt === null
      ? null
      : formatClockDuration(
          Math.max(1_000, Date.parse(task.settledAt) - Date.parse(task.startedAt)),
        );
  switch (task.status) {
    case "running":
      return "running in background";
    case "completed":
      return elapsed ? `finished in background after ${elapsed}` : "finished in background";
    case "failed":
      return elapsed ? `failed in background after ${elapsed}` : "failed in background";
    case "stopped":
      return "stopped";
  }
}
function capitalizePhrase(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return value;
  }
  return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`;
}
function toolWorkEntryHeading(
  workEntry: TimelineWorkEntry,
  classification: ReturnType<typeof classifyWorkEntryTool>,
): string {
  if (workEntry.itemType === "collab_agent_tool_call" && workEntry.subagentAction) {
    return subagentToolHeading(
      workEntry.subagentAction,
      workEntry.subagents ?? [],
      classification.status,
    );
  }
  // Monitor outcomes are semantic copy; the compact tool-label normalizer would strip their
  // trailing status.
  if (workEntry.monitorNotification) {
    return capitalizePhrase(workEntry.label);
  }
  if (workEntry.toolTitle && ownsToolTitle(workEntry)) {
    return workEntry.toolTitle;
  }
  if (classification.gladeTitle) {
    return classification.gladeTitle;
  }
  if (!workEntry.toolTitle) {
    return capitalizePhrase(normalizeCompactToolLabel(workEntry.label));
  }
  return capitalizePhrase(normalizeCompactToolLabel(workEntry.toolTitle));
}
function combineWorkEntryDisplayText(heading: string, preview: string | null): string {
  if (!preview) {
    return heading;
  }
  return normalizeToolTextForComparison(heading) === normalizeToolTextForComparison(preview)
    ? heading
    : `${heading} ${preview}`;
}
function workEntryDisplayParts(
  workEntry: TimelineWorkEntry,
  classification = classifyWorkEntryTool(workEntry),
): {
  heading: string;
  preview: string | null;
  displayText: string;
} {
  const webFetchUrl = extractWebFetchUrl(workEntry);
  const heading = toolWorkEntryHeading(workEntry, classification);
  const rawPreview =
    workEntry.itemType === "collab_agent_tool_call" ? null : workEntryPreview(workEntry);
  const preview =
    !classification.isGitHub && classification.gladeTitle !== null
      ? sanitizeGladeMcpToolPreview({
          preview: rawPreview,
          heading,
          status: classification.status,
        })
      : rawPreview;
  const displayText = webFetchUrl
    ? describeLinkChip(webFetchUrl).label
    : isStatusOnlyCommandWorkEntry(workEntry) && workEntry.toolStatus === "running"
      ? "Running command"
      : combineWorkEntryDisplayText(heading, preview);
  return {
    heading,
    preview,
    displayText,
  };
}
function isFileChangeWorkEntry(workEntry: TimelineWorkEntry): boolean {
  return isFileChangeWorkLogEntry(workEntry);
}
type TimelineWorkEntryRowProps = {
  workEntry: TimelineWorkEntry;
  chatMetaFontSizePx: number;
  textFontSizePx?: number;
  fileDiffStatByPath?: ReadonlyMap<
    string,
    {
      additions: number;
      deletions: number;
    }
  >;
  markdownCwd: string | undefined;
  onImageExpand: (preview: ExpandedImagePreview) => void;
  turnId?: TurnId;
  onOpenTurnDiff?: (turnId: TurnId, filePath?: string) => void;
  activityDetail?: AgentActivityDetail | undefined;
  timestampFormat: TimestampFormat;
};

export const TimelineWorkEntryRow = memo(function TimelineWorkEntryRow(
  props: TimelineWorkEntryRowProps,
) {
  const fontSizePx = props.textFontSizePx ?? props.chatMetaFontSizePx;
  if (props.workEntry.subagentRun) {
    return (
      <SubagentRunCard
        run={props.workEntry.subagentRun}
        launching={props.workEntry.toolStatus === "running"}
        fontSizePx={fontSizePx}
      />
    );
  }
  if (props.workEntry.requestRetries) {
    return <RequestRetryRow retries={props.workEntry.requestRetries} fontSizePx={fontSizePx} />;
  }
  if (props.workEntry.reasoning) {
    return (
      <ReasoningWorkRow
        entry={props.workEntry}
        reasoning={props.workEntry.reasoning}
        fontSizePx={fontSizePx}
        markdownCwd={props.markdownCwd}
        onImageExpand={props.onImageExpand}
      />
    );
  }
  return <ToolWorkEntryRow {...props} />;
});

function ToolWorkEntryRow(props: TimelineWorkEntryRowProps) {
  const {
    workEntry,
    chatMetaFontSizePx,
    textFontSizePx: textFontSizePxProp,
    fileDiffStatByPath,
    markdownCwd,
    onImageExpand,
    turnId,
    onOpenTurnDiff,
    activityDetail,
    timestampFormat,
  } = props;
  const textFontSizePx = textFontSizePxProp ?? chatMetaFontSizePx;
  const isPlainRuntimeNoticeRow = isPlainRuntimeNoticeWorkEntry(workEntry);
  const EntryIcon = workEntryIcon(workEntry);
  const linkIconUrl = workEntryLinkIconUrl(workEntry);
  // A launch that has not reported its subagents yet shows the run card's spinner, so the icon does
  // not change when the card takes this row's place.
  const isPendingSubagentLaunch =
    workEntry.toolKind === "agent" && workEntry.toolStatus === "running";
  const classification = classifyWorkEntryTool(workEntry);
  const isGitHubToolRow = classification.isGitHub;
  const isGladeToolRow = !isGitHubToolRow && classification.gladeTitle !== null;
  const isMcpToolRow =
    workEntry.itemType === "mcp_tool_call" && !isGitHubToolRow && !isGladeToolRow;
  const LeftIcon = workEntryLeftIcon(workEntry, classification);
  const leftIconKind = linkIconUrl
    ? "web-fetch"
    : isGitHubToolRow || EntryIcon === GitHubIcon
      ? "github"
      : isGladeToolRow
        ? "glade"
        : isMcpToolRow
          ? "mcp"
          : undefined;
  const { heading, displayText } = workEntryDisplayParts(workEntry, classification);
  // A shell read names its file through the command label; its raw command text is not a path.
  const isCommandRow = Boolean(
    workEntry.itemType === "command_execution" || workEntry.command || workEntry.rawCommand,
  );
  const rowFilePath =
    workEntry.toolKind === "read" && !isCommandRow
      ? (toolInputFilePath(workEntry.toolDetails?.input) ??
        (workEntry.detail ? extractFilePathFromDetail(workEntry.detail) : null))
      : null;
  const changedFiles = workEntry.changedFiles ?? [];
  const showEditedRows = isFileChangeWorkEntry(workEntry) && changedFiles.length > 0;
  const activityContent = activityDetail ? (
    <AgentActivityDetails
      detail={activityDetail}
      fontSizePx={textFontSizePx}
      markdownCwd={markdownCwd}
      onImageExpand={onImageExpand}
    />
  ) : undefined;
  const hasToolDetails = hasToolCallDetailsContent(
    workEntry.toolDetails,
    workEntry.liveActivity,
    workEntry.toolKind,
  );
  const providerContextLifecycle = workEntry.providerContextLifecycle;
  const monitorNotification = workEntry.monitorNotification;
  const opener = useWorkspaceFileOpener();
  const toolDiffStatsByPath = useMemo(
    () =>
      isFileChangeWorkEntry(workEntry)
        ? fileDiffStatsByPath(workEntry.toolDetails?.diff)
        : EMPTY_FILE_DIFF_STATS,
    [workEntry],
  );
  const liveActivityNowMs = useLiveActivityNow(workEntry.liveActivity);
  const backgroundTask = workEntry.backgroundTask;
  const liveActivityMetaText = backgroundTask
    ? formatBackgroundTaskMeta(backgroundTask)
    : workEntry.liveActivity
      ? formatLiveActivityMeta(workEntry.liveActivity, liveActivityNowMs)
      : null;
  const readFilePath =
    opener !== null &&
    !activityDetail &&
    !isCommandRow &&
    workEntry.detail &&
    workEntry.toolKind === "read"
      ? extractFilePathFromDetail(workEntry.detail)
      : null;
  const canOpenReadFile = readFilePath !== null;
  const canOpenToolDetails =
    !activityDetail && Boolean(providerContextLifecycle || monitorNotification || hasToolDetails);
  const openReadFile = readFilePath
    ? () => openWorkspaceFileReference(opener, readFilePath)
    : undefined;
  const prefetchReadFile =
    readFilePath && opener?.prefetchFile ? () => opener.prefetchFile?.(readFilePath) : undefined;
  const rowFontSizePx = textFontSizePx;
  if (workEntry.activityKind === "response.started")
    return <SubagentReplyNotice entry={workEntry} />;
  if (workEntry.activityKind === "provider.transition")
    return <ProviderTransitionDivider entry={workEntry} detailContent={activityContent} />;
  return (
    <div className={WORK_ROW_BLOCK_CLASS_NAME}>
      {showEditedRows ? (
        <div
          className={
            changedFiles.length > EDITED_FILE_LIST_SCROLL_THRESHOLD
              ? EDITED_FILE_LIST_CLASS_NAME
              : "space-y-0.5"
          }
        >
          {changedFiles.map((changedFilePath) => {
            const summaryStat = fileDiffStatByPath?.get(changedFilePath);
            const changedFileStat =
              summaryStat && summaryStat.additions + summaryStat.deletions > 0
                ? summaryStat
                : (resolveFileDiffStatByChangedPath(
                    toolDiffStatsByPath,
                    changedFilePath,
                    changedFiles.length,
                  ) ?? summaryStat);
            const canOpenEditedDiff = Boolean(turnId && onOpenTurnDiff);
            const canOpenEditedRow = canOpenToolDetails || canOpenEditedDiff;
            const editedRowClassName = cn(
              "group/file-row flex w-full max-w-full items-center text-left transition-colors duration-100",
              WORK_ROW_GAP_CLASS_NAME,
              canOpenEditedRow ? "cursor-pointer focus-visible:outline-none" : "cursor-default",
            );
            const editedRowChildren = (
              <EditedFileRowContent
                filePath={changedFilePath}
                additions={changedFileStat?.additions}
                deletions={changedFileStat?.deletions}
                fontSizePx={rowFontSizePx}
              />
            );
            if (hasToolDetails || (canOpenToolDetails && !canOpenEditedDiff)) {
              return (
                <ToolDetailsDisclosure
                  key={`${workEntry.id}:${changedFilePath}`}
                  details={workEntry.toolDetails}
                  activity={workEntry.liveActivity}
                  summaryClassName={editedRowClassName}
                  dataFileChangeRow
                >
                  {editedRowChildren}
                </ToolDetailsDisclosure>
              );
            }
            return (
              <button
                key={`${workEntry.id}:${changedFilePath}`}
                type="button"
                data-file-change-row="true"
                className={editedRowClassName}
                title={changedFilePath}
                disabled={!canOpenEditedRow}
                onClick={() => {
                  if (!turnId || !onOpenTurnDiff) {
                    return;
                  }
                  onOpenTurnDiff(turnId, changedFilePath);
                }}
              >
                {editedRowChildren}
              </button>
            );
          })}
        </div>
      ) : (
        (() => {
          const rowContentChildren = (
            <>
              {!isPlainRuntimeNoticeRow ? (
                <span
                  className={cn(
                    WORK_ROW_ICON_SLOT_CLASS_NAME,
                    WORK_ROW_MUTED_HOVER_TONE["tool-row"],
                    (workEntry.toolStatus === "failed" ||
                      monitorNotification?.outcome === "failed") &&
                      "text-destructive/85",
                  )}
                  data-tool-icon={leftIconKind}
                  data-work-entry-icon="true"
                >
                  {linkIconUrl ? (
                    <LinkChipIcon url={linkIconUrl} className={WORK_ROW_ICON_CLASS_NAME} />
                  ) : isPendingSubagentLaunch ? (
                    <Spinner variant="subagent" className={WORK_ROW_ICON_CLASS_NAME} />
                  ) : backgroundTask?.status === "running" ? (
                    <Spinner variant="working" className={WORK_ROW_ICON_CLASS_NAME} />
                  ) : (
                    renderWorkEntryIcon(LeftIcon, WORK_ROW_ICON_CLASS_NAME)
                  )}
                </span>
              ) : null}
              <div className="min-w-0 overflow-hidden">
                <p
                  className={cn(
                    "truncate",
                    WORK_ROW_LINE_CLASS_NAME,
                    WORK_ROW_MUTED_HOVER_TONE["tool-row"],
                    isPlainRuntimeNoticeRow && "italic",
                  )}
                  data-runtime-notice-row={isPlainRuntimeNoticeRow ? "true" : undefined}
                  style={{
                    fontSize: `${rowFontSizePx}px`,
                  }}
                >
                  <span
                    className={workEntry.toolStatus === "running" ? "work-text-shimmer" : undefined}
                    data-work-entry-display-text="true"
                  >
                    {rowFilePath ? (
                      <>
                        {heading} <FileNameChip path={rowFilePath} />
                      </>
                    ) : (
                      displayText
                    )}
                  </span>
                  {liveActivityMetaText ? (
                    <span data-live-activity-meta="true"> · {liveActivityMetaText}</span>
                  ) : null}
                </p>
              </div>
            </>
          );
          if (activityContent || canOpenToolDetails) {
            return (
              <ToolDetailsDisclosure
                details={workEntry.toolDetails}
                activity={workEntry.liveActivity}
                toolKind={workEntry.toolKind}
                detailContent={
                  activityContent ??
                  (monitorNotification ? (
                    <MonitorEventDetails
                      notification={monitorNotification}
                      createdAt={workEntry.createdAt}
                      timestampFormat={timestampFormat}
                    />
                  ) : providerContextLifecycle ? (
                    <ProviderContextLifecycleDetails info={providerContextLifecycle} />
                  ) : undefined)
                }
              >
                {rowContentChildren}
              </ToolDetailsDisclosure>
            );
          }
          const rowContent = (
            <AgentActivityOpenSurface
              canOpen={canOpenReadFile}
              onOpen={openReadFile}
              onHover={prefetchReadFile}
            >
              {rowContentChildren}
            </AgentActivityOpenSurface>
          );
          return rowContent;
        })()
      )}
    </div>
  );
}
// Long edit lists scroll in place so one large turn cannot push the rest of the transcript away.
// Short lists stay unclipped so an opened row's diff is not trapped in the list's scroll box.
const EDITED_FILE_LIST_SCROLL_THRESHOLD = 8;
export const EDITED_FILE_LIST_CLASS_NAME =
  "scroll-fade-y max-h-[min(10lh,30vh)] space-y-0.5 overflow-y-auto";

export function EditedFileRowContent(props: {
  filePath: string;
  additions: number | undefined;
  deletions: number | undefined;
  fontSizePx: number;
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
        <FileNameChip path={filePath} />
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
