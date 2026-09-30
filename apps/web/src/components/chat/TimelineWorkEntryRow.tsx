import type { TurnId } from "@glade/contracts/core/baseSchemas";
import { PROVIDER_DESCRIPTORS } from "@glade/shared/provider/providerMetadata";
import {
  createElement,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";

import { basenameOfPath } from "~/file-icons";
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
import { DISCLOSURE_CLEANUP_BUFFER_MS, DISCLOSURE_TRANSITION_MS } from "~/lib/disclosureMotion";

import { isFileChangeWorkLogEntry, type WorkLogEntry } from "../../session-logic";
import {
  formatAgentActivityEntryPreview,
  isAgentActivityWorkEntry,
  isCodexActivityStatusWorkEntry,
  isPlainRuntimeNoticeWorkEntry,
  isReasoningUpdateWorkEntry,
} from "./agentActivity.logic";
import { AutomationCreatedCard } from "./AutomationCreatedCard";
import { ConnectedComputerSetupRequiredCard } from "./ComputerSetupRequiredCard";
import { ComputerControlDeniedCard } from "./ComputerControlDeniedCard";
import ChatMarkdown from "../ChatMarkdown";
import { DiffStatLabel } from "./DiffStatLabel";
import { type ExpandedImagePreview } from "./ExpandedImagePreview";
import { LinkChipIcon } from "../LinkChipIcon";
import { normalizeCompactToolLabel } from "./MessagesTimeline.logic";
import { GladeLogo } from "../GladeLogo";
import { ToolCallDetailsContent } from "./ToolCallDetailsDialog";
import { DisclosureChevron } from "../ui/DisclosureChevron";
import { DisclosureRegion } from "../ui/DisclosureRegion";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { fileDiffStatsByPath, resolveFileDiffStatByChangedPath } from "~/lib/diffRendering";
import {
  extractToolArgumentField,
  isPrefixedToolArgumentSummary,
} from "../../lib/toolArgumentSummary";
import {
  deriveFriendlyCommandTarget,
  deriveGladeMcpToolTitle,
  extractWebFetchUrl,
  isGenericToolTitle,
  isGladeBrowserToolCall,
  normalizeToolTextForComparison,
  resolveCommandVisualKind,
  sanitizeGladeMcpToolPreview,
  type GladeMcpToolStatus,
} from "../../lib/toolCallLabel";
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

export function workEntryLeftIcon(workEntry: TimelineWorkEntry): LucideIcon {
  if (isComputerWorkEntry(workEntry)) return ComputerUseIcon;
  if (isGitHubMcpToolCall(workEntry)) return GitHubIcon;
  if (isGladeBrowserWorkEntry(workEntry)) return GlobeIcon;
  if (isGladeToolCall(workEntry)) return GladeToolIcon;
  if (workEntry.itemType === "mcp_tool_call") return McpIcon;
  return workEntryIcon(workEntry);
}

function isComputerWorkEntry(workEntry: TimelineWorkEntry): boolean {
  return (
    computerToolName(workEntry.toolName) !== null ||
    /^Computer Use:/i.test(workEntry.toolTitle ?? "")
  );
}

function isGitHubMcpToolCall(workEntry: TimelineWorkEntry): boolean {
  const toolName = workEntry.toolName?.trim().toLowerCase();
  return Boolean(toolName?.startsWith("mcp__codex_apps__github"));
}

function toolWorkEntryStatus(workEntry: TimelineWorkEntry): GladeMcpToolStatus {
  if (workEntry.toolStatus) return workEntry.toolStatus;
  return workEntry.activityKind !== undefined && workEntry.activityKind !== "tool.completed"
    ? "running"
    : "completed";
}

function isGladeBrowserWorkEntry(workEntry: TimelineWorkEntry): boolean {
  return isGladeBrowserToolCall({
    toolName: workEntry.toolName,
    title: workEntry.toolTitle,
    fallbackLabel: workEntry.label,
    status: toolWorkEntryStatus(workEntry),
  });
}

function isGladeToolCall(workEntry: TimelineWorkEntry): boolean {
  return (
    deriveGladeMcpToolTitle({
      toolName: workEntry.toolName,
      title: workEntry.toolTitle,
      fallbackLabel: workEntry.label,
      status: toolWorkEntryStatus(workEntry),
    }) !== null
  );
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

function toolWorkEntryHeading(workEntry: TimelineWorkEntry): string {
  if (computerToolName(workEntry.toolName)) {
    const title = normalizeCompactToolLabel(workEntry.toolTitle ?? "");
    if (title && !isGenericToolTitle(title) && !computerToolName(title))
      return capitalizePhrase(title);
    return describeComputerToolCall({ toolName: workEntry.toolName, args: undefined })!.summary;
  }

  if (workEntry.activityKind === "turn.tasks.updated") {
    return capitalizePhrase(workEntry.label);
  }
  const gladeTitle = deriveGladeMcpToolTitle({
    toolName: workEntry.toolName,
    title: workEntry.toolTitle,
    fallbackLabel: workEntry.label,
    status: toolWorkEntryStatus(workEntry),
  });
  if (gladeTitle) {
    return gladeTitle;
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

function workEntryDisplayParts(workEntry: TimelineWorkEntry): {
  heading: string;
  preview: string | null;
  displayText: string;
} {
  const webFetchUrl = extractWebFetchUrl(workEntry);
  const heading = toolWorkEntryHeading(workEntry);
  const rawPreview = workEntryPreview(workEntry);
  const preview =
    !isGitHubMcpToolCall(workEntry) &&
    (isGladeBrowserWorkEntry(workEntry) || isGladeToolCall(workEntry))
      ? sanitizeGladeMcpToolPreview({
          preview: rawPreview,
          heading,
          status: toolWorkEntryStatus(workEntry),
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

function ToolRowTooltip(props: { content: ReactNode; children: ReactElement }) {
  if (!props.content) {
    return props.children;
  }
  return (
    <Tooltip>
      <TooltipTrigger render={props.children} />
      <TooltipPopup side="top" align="start" className="max-w-96 whitespace-normal">
        {props.content}
      </TooltipPopup>
    </Tooltip>
  );
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
  onOpenAutomation?: (automationId: string) => void;
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
    onOpenAutomation,
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

  const isGitHubToolRow = isGitHubMcpToolCall(workEntry);
  const isComputerToolRow = isComputerWorkEntry(workEntry);
  const isGladeBrowserToolRow = !isGitHubToolRow && isGladeBrowserWorkEntry(workEntry);
  const isGladeToolRow = !isGitHubToolRow && !isGladeBrowserToolRow && isGladeToolCall(workEntry);
  const isMcpToolRow =
    workEntry.itemType === "mcp_tool_call" &&
    !isGitHubToolRow &&
    !isGladeBrowserToolRow &&
    !isGladeToolRow;
  const LeftIcon = workEntryLeftIcon(workEntry);
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
  const { heading, preview, displayText } = workEntryDisplayParts(workEntry);
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

  // A created-automation row renders as its own card instead of a tool-call line. Kept after the
  // hooks above so the early return never changes hook order.
  const automation = workEntry.automation;
  if (automation) {
    return (
      <div className={cn(compact ? "py-0.5" : "py-1")}>
        <AutomationCreatedCard
          automationId={automation.id}
          name={automation.name}
          cadenceLabel={automation.cadenceLabel}
          {...(automation.proposalState ? { proposalState: automation.proposalState } : {})}
          textFontSizePx={textFontSizePx}
          metaFontSizePx={chatMetaFontSizePx}
          {...(onOpenAutomation ? { onOpen: () => onOpenAutomation(automation.id) } : {})}
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
              "group/file-row flex w-full max-w-full items-center text-left transition-colors duration-120",
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

function AgentActivityOpenSurface(props: {
  canOpen: boolean;
  children: ReactNode;
  compact: boolean;

  onHover?: (() => void) | undefined;
  onOpen?: (() => void) | undefined;
  title?: string | undefined;

  tooltip?: ReactNode;
  dataToolDetailTrigger?: boolean | undefined;
}) {
  const className = cn(
    "group/tool-row flex w-full items-center text-left transition-[opacity,translate] duration-160",
    props.compact ? "gap-1.5" : "gap-2",
    props.canOpen ? "cursor-pointer focus-visible:outline-none" : "cursor-default",
  );

  const surface = props.canOpen ? (
    <button
      type="button"
      className={className}
      title={props.title}
      onClick={props.onOpen}
      data-tool-detail-trigger={props.dataToolDetailTrigger ? "true" : undefined}
      {...(props.onHover ? { onPointerEnter: props.onHover, onFocus: props.onHover } : {})}
    >
      {props.children}
    </button>
  ) : (
    <div className={className} title={props.title}>
      {props.children}
    </div>
  );

  return <ToolRowTooltip content={props.tooltip}>{surface}</ToolRowTooltip>;
}

function providerContextLifecycleReasonLabel(
  reason: NonNullable<TimelineWorkEntry["providerContextLifecycle"]>["restartReason"],
): string {
  switch (reason) {
    case "conversation-rebuilt":
      return "Conversation rebuilt from a summary";
    case "fresh-session":
      return "New session started";
    case "interrupt-escalation":
      return "Turn stop escalated to a session restart";
    case "native-history-unavailable":
      return "Previous history unavailable";
    case "native-resume-failed":
      return "Could not resume the previous session";
  }
}

function ProviderContextLifecycleDetails(props: {
  info: NonNullable<TimelineWorkEntry["providerContextLifecycle"]>;
}) {
  const { info } = props;
  const provider =
    PROVIDER_DESCRIPTORS.find((descriptor) => descriptor.kind === info.provider)?.displayName ??
    info.provider;
  return (
    <div className="space-y-3" data-provider-context-lifecycle-details="true">
      <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1.5 rounded-lg border border-border/45 bg-background/60 px-3 py-2.5 text-ui-sm">
        <dt className="text-muted-foreground/56">Provider</dt>
        <dd className="text-foreground/84">{provider}</dd>
        <dt className="text-muted-foreground/56">Previous history</dt>
        <dd className="text-foreground/84">
          {info.nativeHistory === "available" ? "Available" : "Lost"}
        </dd>
        <dt className="text-muted-foreground/56">Session restarted</dt>
        <dd className="text-foreground/84">{info.sessionRestarted ? "Yes" : "No"}</dd>
        <dt className="text-muted-foreground/56">Why</dt>
        <dd className="text-foreground/84">
          {providerContextLifecycleReasonLabel(info.restartReason)}
        </dd>
        <dt className="text-muted-foreground/56">Summary included</dt>
        <dd className="text-foreground/84">
          {info.recapInjected ? `${info.recapCharacters.toLocaleString()} characters` : "No"}
        </dd>
      </dl>
      {info.recapPreview ? (
        <section className="space-y-2">
          <h3 className="text-ui-sm font-medium text-muted-foreground/56">Summary preview</h3>
          <pre
            className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border/45 bg-background/60 px-3 py-2.5 font-chat-code text-chat-code leading-relaxed text-foreground/84"
            data-session-context-recap-preview="true"
          >
            {info.recapPreview}
          </pre>
          {info.recapPreviewTruncated ? (
            <p className="text-ui-xs text-muted-foreground/56">
              Showing a short preview of the summary sent with your message.
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function ToolDetailsDisclosure(props: {
  children: ReactNode;
  compact: boolean;
  dataFileChangeRow?: boolean | undefined;
  details?: TimelineWorkEntry["toolDetails"] | undefined;
  activity?: TimelineWorkEntry["liveActivity"] | undefined;
  detailContent?: ReactNode;
  summaryClassName?: string | undefined;
  timestampFormat: TimestampFormat;
  tooltip?: ReactNode;
}) {
  const summaryClassName =
    props.summaryClassName ??
    cn(
      "group/tool-row flex w-full items-center text-left transition-[opacity,translate] duration-160",
      props.compact ? "gap-1.5" : "gap-2",
      "cursor-pointer focus-visible:outline-none",
    );
  const [open, setOpen] = useState(false);
  const [renderDetails, setRenderDetails] = useState(false);
  const [motionOpen, setMotionOpen] = useState(false);
  const openFrameRef = useRef<number | null>(null);
  const cleanupTimeoutRef = useRef<number | null>(null);

  const clearMotionTimers = useCallback(() => {
    if (openFrameRef.current !== null) {
      window.cancelAnimationFrame(openFrameRef.current);
      openFrameRef.current = null;
    }
    if (cleanupTimeoutRef.current !== null) {
      window.clearTimeout(cleanupTimeoutRef.current);
      cleanupTimeoutRef.current = null;
    }
  }, []);

  const setDetailsOpen = useCallback(
    (nextOpen: boolean) => {
      clearMotionTimers();
      setOpen(nextOpen);

      if (nextOpen) {
        setRenderDetails(true);
        setMotionOpen(false);
        openFrameRef.current = window.requestAnimationFrame(() => {
          openFrameRef.current = null;
          setMotionOpen(true);
        });
        return;
      }

      setMotionOpen(false);
      cleanupTimeoutRef.current = window.setTimeout(() => {
        cleanupTimeoutRef.current = null;
        setRenderDetails(false);
      }, DISCLOSURE_TRANSITION_MS + DISCLOSURE_CLEANUP_BUFFER_MS);
    },
    [clearMotionTimers],
  );

  useEffect(() => () => clearMotionTimers(), [clearMotionTimers]);

  const summaryButton = (
    <button
      type="button"
      className={summaryClassName}
      aria-expanded={open}
      data-file-change-row={props.dataFileChangeRow ? "true" : undefined}
      data-tool-detail-trigger="true"
      onClick={() => {
        setDetailsOpen(!open);
      }}
    >
      {props.children}
      <DisclosureChevron
        open={open}
        className="text-muted-foreground/70 group-hover/tool-row:text-foreground group-hover/file-row:text-foreground group-focus-visible/tool-row:text-foreground group-focus-visible/file-row:text-foreground"
      />
    </button>
  );

  return (
    <div className="group/tool-details min-w-0">
      <ToolRowTooltip content={props.tooltip}>{summaryButton}</ToolRowTooltip>
      {renderDetails ? (
        <DisclosureRegion
          open={motionOpen}
          contentClassName={cn("min-w-0 pt-2", props.compact ? "ml-5" : "ml-7")}
        >
          <div data-tool-details-inline="true">
            {props.detailContent ?? (
              <ToolCallDetailsContent
                details={props.details}
                activity={props.activity}
                timestampFormat={props.timestampFormat}
              />
            )}
          </div>
        </DisclosureRegion>
      ) : null}
    </div>
  );
}
