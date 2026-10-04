import { ProviderTransitionDivider } from "./ProviderTransitionDivider";
import type { TurnId } from "@glade/contracts/core/baseSchemas";
import { createElement, memo, useMemo, type ReactElement, type ReactNode } from "react";

import { basenameOfPath } from "~/file-icons";
import {
  AgentActivityOpenSurface,
  ProviderContextLifecycleDetails,
  ToolDetailsDisclosure,
} from "./TimelineWorkEntryDetails";
import type { TimestampFormat } from "../../appSettings";
import {
  ArrowUpCircleIcon,
  BackgroundTrayIcon,
  BookOpenIcon,
  BotIcon,
  CheckIcon,
  CircleAlertIcon,
  CircleQuestionIcon,
  ContextCompactionIcon,
  ComputerUseIcon,
  EyeIcon,
  GitHubIcon,
  GlobeIcon,
  HammerIcon,
  HistoryIcon,
  type LucideIcon,
  McpIcon,
  PencilIcon,
  SearchIcon,
  SkillCubeIcon,
  TerminalIcon,
  ZapIcon,
} from "~/lib/icons";
import { describeLinkChip } from "~/lib/linkChips";
import { computerToolName, describeComputerToolCall } from "~/lib/computerToolPresentation";
import { cn } from "~/lib/utils";

import { isFileChangeWorkLogEntry, type WorkLogEntry } from "../../workLog.types";
import {
  formatAgentActivityEntryPreview,
  isAgentActivityWorkEntry,
  isCodexActivityStatusWorkEntry,
  isPlainRuntimeNoticeWorkEntry,
  isReasoningUpdateWorkEntry,
} from "./agentActivity.logic";
import { ConnectedComputerSetupRequiredCard } from "./ComputerSetupRequiredCard";
import { ComputerControlDeniedCard } from "./ComputerControlDeniedCard";
import ChatMarkdown from "../ChatMarkdown";
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
  isGenericToolTitle,
  isGladeBrowserToolCall,
  sanitizeGladeMcpToolPreview,
  type GladeMcpToolStatus,
} from "../../lib/toolCallLabel.descriptors";
import {
  extractWebFetchUrl,
  normalizeToolTextForComparison,
} from "../../lib/toolCallLabel.presentations";
import { formatLiveActivityMeta, useLiveActivityNow } from "../../lib/liveActivityPresentation";
import { openWorkspaceFileReference, useWorkspaceFileOpener } from "../../lib/workspaceFileOpener";
import { MUTED_LABEL_TEXT_CLASS_NAME, MUTED_LABEL_TEXT_COLOR } from "~/surfaceStyles";

const WORK_ROW_MUTED_HOVER_TONE: Record<"tool-row" | "file-row", string> = {
  "tool-row": `${MUTED_LABEL_TEXT_CLASS_NAME} transition-colors group-hover/tool-row:text-foreground group-focus-visible/tool-row:text-foreground`,
  "file-row": `${MUTED_LABEL_TEXT_CLASS_NAME} transition-colors group-hover/file-row:text-foreground group-focus-visible/file-row:text-foreground`,
};
const EMPTY_FILE_DIFF_STATS: ReadonlyMap<string, { additions: number; deletions: number }> =
  new Map();

type TimelineWorkEntry = WorkLogEntry;

const AgentTaskIcon: LucideIcon = (props) => <BotIcon {...props} />;

const GladeToolIcon: LucideIcon = ({ className, ...props }) => (
  <GladeLogo {...props} className={cn("text-current", className)} />
);

function workToneIcon(tone: TimelineWorkEntry["tone"]): {
  icon: LucideIcon;
  className: string;
} {
  if (tone === "error") {
    return {
      icon: CircleAlertIcon,
      className: "text-muted-foreground/50",
    };
  }
  if (tone === "thinking") {
    return {
      icon: BotIcon,
      className: "text-muted-foreground/40",
    };
  }
  if (tone === "info") {
    return {
      icon: CheckIcon,
      className: "text-muted-foreground/50",
    };
  }

  return {
    icon: BookOpenIcon,
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

function workEntryPreview(workEntry: TimelineWorkEntry): string | null {
  if (isReasoningUpdateWorkEntry(workEntry)) {
    return formatAgentActivityEntryPreview(workEntry);
  }
  const isFileRelated =
    workEntry.requestKind === "file-read" ||
    workEntry.requestKind === "file-change" ||
    workEntry.itemType === "file_change";

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

  if (workEntry.itemType === "collab_agent_tool_call") {
    return workEntry.detail ?? workEntry.subagentAction?.prompt ?? null;
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

function isFileReadToolEntry(workEntry: TimelineWorkEntry): boolean {
  const name = (workEntry.toolName ?? "").toLowerCase().replace(/[^a-z]/g, "");
  return name === "read" || name === "readfile" || name === "viewfile";
}

function commandWorkEntryIcon(workEntry: TimelineWorkEntry): LucideIcon {
  const command = workEntry.command ?? workEntry.rawCommand;
  switch (command ? resolveCommandVisualKind(command) : "terminal") {
    case "inspect":
      return SearchIcon;
    case "git":
    case "github":
      return GitHubIcon;
    case "terminal":
      return TerminalIcon;
  }
}

function workEntryIcon(workEntry: TimelineWorkEntry): LucideIcon {
  if (workEntry.activityKind === "user-input.requested") return CircleQuestionIcon;
  if (workEntry.activityKind === "user-input.resolved") return ArrowUpCircleIcon;
  if (workEntry.activityKind === "context-compaction") return ContextCompactionIcon;

  if (workEntry.nativeEventType === "background_tasks_changed") return BackgroundTrayIcon;
  if (workEntry.providerContextLifecycle) {
    return workEntry.providerContextLifecycle.nativeHistory === "unavailable"
      ? CircleAlertIcon
      : HistoryIcon;
  }

  if (workEntry.requestKind === "command") return commandWorkEntryIcon(workEntry);
  if (workEntry.requestKind === "file-read") return SearchIcon;
  if (workEntry.requestKind === "file-change") return PencilIcon;
  if (workEntry.requestKind === "tool") return McpIcon;

  if (workEntry.itemType === "command_execution" || workEntry.command) {
    return commandWorkEntryIcon(workEntry);
  }
  if (workEntry.itemType === "file_change") {
    return PencilIcon;
  }
  if (workEntry.itemType === "web_search") return GlobeIcon;
  if (workEntry.itemType === "image_generation") return ZapIcon;
  if (workEntry.itemType === "image_view") return EyeIcon;
  if (isFileReadToolEntry(workEntry)) return SearchIcon;

  switch (workEntry.itemType) {
    case "mcp_tool_call":
      return SkillCubeIcon;
    case "dynamic_tool_call":
      return HammerIcon;
    case "collab_agent_tool_call":
      return AgentTaskIcon;
  }

  return workToneIcon(workEntry.tone).icon;
}

export function renderWorkEntryIcon(Icon: LucideIcon, className: string): ReactElement {
  return createElement(Icon, { className });
}

export function workEntryLeftIcon(
  workEntry: TimelineWorkEntry,
  classification = classifyWorkEntryTool(workEntry),
): LucideIcon {
  if (classification.isComputer) return ComputerUseIcon;
  if (classification.isGitHub) return GitHubIcon;
  if (classification.isGladeBrowser) return GlobeIcon;
  if (classification.gladeTitle !== null) return GladeToolIcon;
  if (workEntry.itemType === "mcp_tool_call") return McpIcon;
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
  const computerTool = computerToolName(workEntry.toolName);
  return {
    status,
    computerTool,
    isComputer: computerTool !== null || /^Computer Use:/i.test(workEntry.toolTitle ?? ""),
    isGitHub: Boolean(
      workEntry.toolName?.trim().toLowerCase().startsWith("mcp__codex_apps__github"),
    ),
    isGladeBrowser: isGladeBrowserToolCall(titleInput),
    gladeTitle: deriveGladeMcpToolTitle(titleInput),
  };
}

export function prefersCompactWorkEntryRow(workEntry: TimelineWorkEntry): boolean {
  if (isCodexActivityStatusWorkEntry(workEntry)) {
    return true;
  }

  if (workEntry.itemType === "command_execution" || workEntry.command || workEntry.rawCommand) {
    return true;
  }
  const EntryIcon = workEntryIcon(workEntry);
  return (
    EntryIcon === TerminalIcon ||
    EntryIcon === HammerIcon ||
    EntryIcon === AgentTaskIcon ||
    EntryIcon === PencilIcon ||
    EntryIcon === SkillCubeIcon ||
    EntryIcon === SearchIcon
  );
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
  if (classification.computerTool) {
    const title = normalizeCompactToolLabel(workEntry.toolTitle ?? "");
    if (title && !isGenericToolTitle(title) && !computerToolName(title))
      return capitalizePhrase(title);
    return describeComputerToolCall({ toolName: workEntry.toolName, args: undefined })!.summary;
  }

  if (workEntry.activityKind === "turn.tasks.updated") {
    return capitalizePhrase(workEntry.label);
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
  const rawPreview = workEntryPreview(workEntry);
  const preview =
    !classification.isGitHub &&
    (classification.isGladeBrowser || classification.gladeTitle !== null)
      ? sanitizeGladeMcpToolPreview({
          preview: rawPreview,
          heading,
          status: classification.status,
        })
      : rawPreview;
  const displayText = webFetchUrl
    ? describeLinkChip(webFetchUrl).label
    : isReasoningUpdateWorkEntry(workEntry) && preview
      ? preview
      : combineWorkEntryDisplayText(heading, preview);
  return { heading, preview, displayText };
}

export function workEntryDisplayText(workEntry: TimelineWorkEntry): string {
  return workEntryDisplayParts(workEntry).displayText;
}

function isFileChangeWorkEntry(workEntry: TimelineWorkEntry): boolean {
  return isFileChangeWorkLogEntry(workEntry);
}

function commandTooltipContent(command: string, displayText: string) {
  return (
    <div className="max-w-96 whitespace-pre-wrap leading-tight">
      <div className="space-y-2">
        <div className="space-y-0.5">
          <div className="text-muted-foreground/70">Summary</div>
          <div>{displayText}</div>
        </div>
        <div className="space-y-0.5">
          <div className="text-muted-foreground/70">Raw call</div>
          <code className="block whitespace-pre-wrap break-words font-chat-code text-chat-code text-foreground/92">
            {command}
          </code>
        </div>
      </div>
    </div>
  );
}

// Hover content for a tool-call row: the rich command card when a raw command is present, otherwise
// the plain label (used to reveal truncated text / file paths). Returns null when there's nothing
// worth showing so the row renders untouched.
function toolRowTooltipContent(
  rawCommand: string | null | undefined,
  displayText: string,
  fallback: string | undefined,
): ReactNode {
  if (rawCommand) {
    return commandTooltipContent(rawCommand, displayText);
  }
  return fallback ? <span className="whitespace-pre-wrap">{fallback}</span> : null;
}

export const TimelineWorkEntryRow = memo(function TimelineWorkEntryRow(props: {
  workEntry: TimelineWorkEntry;
  chatMetaFontSizePx: number;
  textFontSizePx?: number;
  density?: "default" | "compact";
  fileDiffStatByPath?: ReadonlyMap<string, { additions: number; deletions: number }>;
  markdownCwd: string | undefined;
  onImageExpand: (preview: ExpandedImagePreview) => void;
  turnId?: TurnId;
  onOpenTurnDiff?: (turnId: TurnId, filePath?: string) => void;
  onOpenAgentActivity?: (activityId: string) => void;
  computerControlEnabled?: boolean;
  onEnableComputerControl?: () => void;
  timestampFormat: TimestampFormat;
}) {
  const {
    workEntry,
    chatMetaFontSizePx,
    textFontSizePx: textFontSizePxProp,
    density: densityProp,
    fileDiffStatByPath,
    markdownCwd,
    onImageExpand,
    turnId,
    onOpenTurnDiff,
    onOpenAgentActivity,
    computerControlEnabled,
    onEnableComputerControl,
    timestampFormat,
  } = props;
  const textFontSizePx = textFontSizePxProp ?? chatMetaFontSizePx;
  const density = densityProp ?? "default";
  const compact = density === "compact";
  const isCodexStatusRow = isCodexActivityStatusWorkEntry(workEntry);
  const isPlainRuntimeNoticeRow = isPlainRuntimeNoticeWorkEntry(workEntry);
  const EntryIcon = workEntryIcon(workEntry);

  const webFetchUrl = extractWebFetchUrl(workEntry);

  const classification = classifyWorkEntryTool(workEntry);
  const isGitHubToolRow = classification.isGitHub;
  const isComputerToolRow = classification.isComputer;
  const isGladeBrowserToolRow = !isGitHubToolRow && classification.isGladeBrowser;
  const isGladeToolRow =
    !isGitHubToolRow && !isGladeBrowserToolRow && classification.gladeTitle !== null;
  const isMcpToolRow =
    workEntry.itemType === "mcp_tool_call" &&
    !isGitHubToolRow &&
    !isGladeBrowserToolRow &&
    !isGladeToolRow;
  const LeftIcon = workEntryLeftIcon(workEntry, classification);
  const leftIconKind = webFetchUrl
    ? "web-fetch"
    : isComputerToolRow
      ? "computer"
      : isGitHubToolRow || EntryIcon === GitHubIcon
        ? "github"
        : isGladeBrowserToolRow
          ? "browser"
          : isGladeToolRow
            ? "glade"
            : isMcpToolRow
              ? "mcp"
              : undefined;
  const { heading, preview, displayText } = workEntryDisplayParts(workEntry, classification);
  const showInlineAgentTaskPreview =
    workEntry.itemType === "collab_agent_tool_call" &&
    Boolean(preview) &&
    normalizeToolTextForComparison(heading) !== normalizeToolTextForComparison(preview ?? "");
  const rawCommand = workEntry.rawCommand ?? workEntry.command;
  const hoverText =
    rawCommand ?? (showInlineAgentTaskPreview ? heading : (webFetchUrl ?? displayText));
  const changedFiles = workEntry.changedFiles ?? [];
  const showEditedRows = isFileChangeWorkEntry(workEntry) && changedFiles.length > 0;
  const canOpenAgentActivity = Boolean(onOpenAgentActivity) && isAgentActivityWorkEntry(workEntry);
  const openAgentActivity = canOpenAgentActivity
    ? () => onOpenAgentActivity?.(workEntry.id)
    : undefined;
  const hasToolDetails = Boolean(workEntry.toolDetails);
  const providerContextLifecycle = workEntry.providerContextLifecycle;

  const opener = useWorkspaceFileOpener();

  const toolDiffStatsByPath = useMemo(
    () =>
      isFileChangeWorkEntry(workEntry)
        ? fileDiffStatsByPath(workEntry.toolDetails?.diff)
        : EMPTY_FILE_DIFF_STATS,
    [workEntry],
  );
  const liveActivityNowMs = useLiveActivityNow(workEntry.liveActivity);
  const liveActivityMetaText = workEntry.liveActivity
    ? formatLiveActivityMeta(workEntry.liveActivity, liveActivityNowMs, {
        subagent: workEntry.itemType === "collab_agent_tool_call",
      })
    : null;

  // A computer-control denial renders as an actionable card (enable + retry) instead of a buried
  // tool-error line. Kept after the hooks above so the early return never changes hook order.
  if (workEntry.computerSetupRequired) {
    return (
      <ConnectedComputerSetupRequiredCard
        {...workEntry.computerSetupRequired}
        textFontSizePx={textFontSizePx}
        metaFontSizePx={chatMetaFontSizePx}
      />
    );
  }

  const computerControlDenied = workEntry.computerControlDenied;
  if (computerControlDenied) {
    return (
      <div className={cn(compact ? "py-0.5" : "py-1")}>
        <ComputerControlDeniedCard
          {...(computerControlEnabled !== undefined ? { computerControlEnabled } : {})}
          textFontSizePx={textFontSizePx}
          metaFontSizePx={chatMetaFontSizePx}
          {...(onEnableComputerControl ? { onEnable: onEnableComputerControl } : {})}
        />
      </div>
    );
  }

  const readFilePath =
    opener !== null &&
    !canOpenAgentActivity &&
    workEntry.detail &&
    (workEntry.requestKind === "file-read" || isFileReadToolEntry(workEntry))
      ? extractFilePathFromDetail(workEntry.detail)
      : null;
  const canOpenReadFile = readFilePath !== null;
  const canOpenToolDetails =
    !canOpenAgentActivity &&
    Boolean(
      providerContextLifecycle ||
      workEntry.toolDetails ||
      (workEntry.liveActivity && !canOpenReadFile),
    );
  const openReadFile = readFilePath
    ? () => openWorkspaceFileReference(opener, readFilePath)
    : undefined;
  const prefetchReadFile =
    readFilePath && opener?.prefetchFile ? () => opener.prefetchFile?.(readFilePath) : undefined;

  const rowFontSizePx = textFontSizePx;

  if (workEntry.activityKind === "provider.transition")
    return <ProviderTransitionDivider entry={workEntry} onInspect={onOpenAgentActivity} />;

  return (
    <div className={cn(compact ? "py-0.5" : "rounded-lg py-1")}>
      {showEditedRows ? (
        <div className="space-y-0.5">
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
              compact ? "gap-1.5" : "gap-2",
              canOpenEditedRow ? "cursor-pointer focus-visible:outline-none" : "cursor-default",
            );
            const editedRowChildren = (
              <EditedFileRowContent
                filePath={changedFilePath}
                additions={changedFileStat?.additions}
                deletions={changedFileStat?.deletions}
                fontSizePx={rowFontSizePx}
                compact={compact}
              />
            );
            if (hasToolDetails || (canOpenToolDetails && !canOpenEditedDiff)) {
              return (
                <ToolDetailsDisclosure
                  key={`${workEntry.id}:${changedFilePath}`}
                  details={workEntry.toolDetails}
                  activity={workEntry.liveActivity}
                  compact={compact}
                  tooltip={<span className="whitespace-pre-wrap">{changedFilePath}</span>}
                  summaryClassName={editedRowClassName}
                  dataFileChangeRow
                  timestampFormat={timestampFormat}
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
              {!isCodexStatusRow && !isPlainRuntimeNoticeRow ? (
                <span
                  className={cn(
                    "flex shrink-0 items-center justify-center",
                    WORK_ROW_MUTED_HOVER_TONE["tool-row"],
                    compact ? "size-4" : "size-5",
                  )}
                  data-tool-icon={leftIconKind}
                  data-work-entry-icon="true"
                >
                  {webFetchUrl ? (
                    <LinkChipIcon url={webFetchUrl} className={compact ? "size-3.5" : "size-4"} />
                  ) : (
                    renderWorkEntryIcon(LeftIcon, compact ? "size-3.5" : "size-4")
                  )}
                </span>
              ) : null}
              <div
                className={cn(
                  "min-w-0 overflow-hidden",

                  showInlineAgentTaskPreview && "flex-1",
                )}
              >
                {showInlineAgentTaskPreview ? (
                  <div className={cn(compact ? "space-y-[1px]" : "space-y-0.5")}>
                    <p
                      className={cn("truncate font-medium leading-5", MUTED_LABEL_TEXT_CLASS_NAME)}
                      style={{ fontSize: `${rowFontSizePx}px` }}
                    >
                      <span data-work-entry-display-text="true">{heading}</span>
                      {liveActivityMetaText ? (
                        <span data-live-activity-meta="true"> · {liveActivityMetaText}</span>
                      ) : null}
                    </p>
                    <ChatMarkdown
                      text={preview ?? ""}
                      cwd={markdownCwd}
                      isStreaming={false}
                      className="leading-relaxed"
                      style={{
                        color: MUTED_LABEL_TEXT_COLOR,
                        fontSize: `${Math.max(11, rowFontSizePx - 1)}px`,
                        lineHeight: compact ? "18px" : "19px",
                      }}
                      onImageExpand={onImageExpand}
                    />
                  </div>
                ) : (
                  <p
                    className={cn(
                      compact ? "truncate leading-5" : "truncate leading-6",

                      WORK_ROW_MUTED_HOVER_TONE["tool-row"],
                      isPlainRuntimeNoticeRow && "italic",
                    )}
                    data-runtime-notice-row={isPlainRuntimeNoticeRow ? "true" : undefined}
                    data-codex-status-row={isCodexStatusRow ? "true" : undefined}
                    style={{ fontSize: `${rowFontSizePx}px` }}
                  >
                    <span data-work-entry-display-text="true">{displayText}</span>
                    {liveActivityMetaText ? (
                      <span data-live-activity-meta="true"> · {liveActivityMetaText}</span>
                    ) : null}
                  </p>
                )}
              </div>
            </>
          );
          if (canOpenToolDetails) {
            return (
              <ToolDetailsDisclosure
                details={workEntry.toolDetails}
                activity={workEntry.liveActivity}
                detailContent={
                  providerContextLifecycle ? (
                    <ProviderContextLifecycleDetails info={providerContextLifecycle} />
                  ) : undefined
                }
                compact={compact}
                timestampFormat={timestampFormat}
                tooltip={toolRowTooltipContent(rawCommand, displayText, displayText)}
              >
                {rowContentChildren}
              </ToolDetailsDisclosure>
            );
          }

          const rowContent = (
            <AgentActivityOpenSurface
              canOpen={canOpenAgentActivity || canOpenReadFile}
              compact={compact}
              onOpen={openAgentActivity ?? openReadFile}
              onHover={prefetchReadFile}
              tooltip={toolRowTooltipContent(
                rawCommand,
                displayText,
                canOpenReadFile ? (readFilePath ?? hoverText) : hoverText,
              )}
            >
              {rowContentChildren}
            </AgentActivityOpenSurface>
          );

          return rowContent;
        })()
      )}
    </div>
  );
});

export function EditedFileRowContent(props: {
  filePath: string;
  additions: number | undefined;
  deletions: number | undefined;
  fontSizePx: number;
  compact: boolean;
}) {
  const { filePath, additions, deletions, fontSizePx, compact } = props;
  const hasStat = (additions ?? 0) + (deletions ?? 0) > 0;
  return (
    <>
      <span
        className={cn(
          "flex shrink-0 items-center justify-center",
          WORK_ROW_MUTED_HOVER_TONE["file-row"],
          compact ? "size-4" : "size-5",
        )}
        data-tool-icon="edit"
      >
        <PencilIcon className={compact ? "size-3.5" : "size-4"} />
      </span>
      <span
        className={cn("font-system-ui shrink-0", WORK_ROW_MUTED_HOVER_TONE["file-row"])}
        style={{ fontSize: `${fontSizePx}px` }}
      >
        Edited
      </span>
      <span
        className={cn(
          "font-system-ui max-w-[28rem] truncate underline-offset-2",
          WORK_ROW_MUTED_HOVER_TONE["file-row"],

          "group-hover/file-row:underline group-focus-visible/file-row:underline",
        )}
        style={{ fontSize: `${fontSizePx}px` }}
      >
        {basenameOfPath(filePath)}
      </span>
      {hasStat ? (
        <span
          className="font-system-ui shrink-0 tabular-nums whitespace-nowrap"
          style={{ fontSize: `${fontSizePx}px` }}
        >
          <DiffStatLabel additions={additions ?? 0} deletions={deletions ?? 0} />
        </span>
      ) : null}
    </>
  );
}
