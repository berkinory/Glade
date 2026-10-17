import { useEffect, useRef, type ReactNode } from "react";
import type { WorkLogEntry } from "~/workLog.types";
import { useToolCallRevealSignal } from "./toolCallReveal";

import { DisclosureChevron } from "../ui/DisclosureChevron";
import { DisclosureRegion } from "../ui/DisclosureRegion";
import { Spinner } from "../ui/spinner";
import { cn } from "~/lib/utils";
import { MUTED_LABEL_TEXT_CLASS_NAME } from "~/surfaceStyles";
import { LinkChipIcon } from "../LinkChipIcon";
import {
  Book02Icon,
  ComputerTerminal01Icon,
  CursorInWindowIcon,
  Globe02Icon,
  Image01Icon,
  PencilEdit02Icon,
  SearchIcon,
  ToolsIcon,
  ViewIcon,
} from "~/lib/icons";
import type { IconComponent } from "~/lib/iconComponent";
import type { ToolCallGroupActivity, ToolCallGroupSummary } from "./toolCallGroup.logic";
import {
  renderWorkEntryIcon,
  workEntryLeftIcon,
  workEntryLinkIconUrl,
} from "./TimelineWorkEntryRow";
import {
  WORK_ROW_BLOCK_CLASS_NAME,
  WORK_ROW_CHEVRON_CLASS_NAME,
  WORK_ROW_GAP_CLASS_NAME,
  WORK_ROW_ICON_CLASS_NAME,
  WORK_ROW_ICON_SLOT_CLASS_NAME,
  WORK_ROW_LINE_CLASS_NAME,
} from "./workRowStyles";
import { WorkTextShimmer } from "./WorkTextShimmer";
import { SubagentAvatar } from "./SubagentAvatar";
import { lastSubagentThreadId } from "./SubagentAvatar.logic";

const ACTIVITY_ICONS: Record<Exclude<ToolCallGroupActivity, "tools" | "agent">, IconComponent> = {
  edit: PencilEdit02Icon,
  command: ComputerTerminal01Icon,
  explore: SearchIcon,
  browse: Globe02Icon,
  computer: CursorInWindowIcon,
  skill: Book02Icon,
  image_view: ViewIcon,
  image_generation: Image01Icon,
};

function renderGroupIcon(summary: ToolCallGroupSummary, entries: readonly WorkLogEntry[]) {
  const { activity, iconEntry } = summary;
  if (activity === "mixed") return renderWorkEntryIcon(ToolsIcon, WORK_ROW_ICON_CLASS_NAME);
  if (activity === "agent") {
    const threadId = lastSubagentThreadId(entries);
    return threadId ? (
      <SubagentAvatar threadId={threadId} className={WORK_ROW_ICON_CLASS_NAME} />
    ) : (
      renderWorkEntryIcon(ToolsIcon, WORK_ROW_ICON_CLASS_NAME)
    );
  }
  if (activity !== "tools") {
    return renderWorkEntryIcon(ACTIVITY_ICONS[activity], WORK_ROW_ICON_CLASS_NAME);
  }
  const webFetchUrl = workEntryLinkIconUrl(iconEntry);
  return webFetchUrl ? (
    <LinkChipIcon url={webFetchUrl} className={WORK_ROW_ICON_CLASS_NAME} />
  ) : (
    renderWorkEntryIcon(workEntryLeftIcon(iconEntry), WORK_ROW_ICON_CLASS_NAME)
  );
}

export function ToolCallGroupSummaryRow(props: {
  summary: ToolCallGroupSummary;
  entries: readonly WorkLogEntry[];
  live?: boolean;
  open: boolean;
  onToggle: (open: boolean) => void;
  fontSizePx: number;
  renderChildren: () => ReactNode;
}) {
  const { summary, entries, live = false, open, onToggle, fontSizePx, renderChildren } = props;
  const revealSignal = useToolCallRevealSignal((toolCallId) =>
    entries.some((entry) => entry.toolCallId === toolCallId),
  );
  // Opens once per reveal request, so a later toggle by the reader stands.
  const handledReveal = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (revealSignal === undefined || handledReveal.current === revealSignal) return;
    handledReveal.current = revealSignal;
    onToggle(true);
  }, [revealSignal, onToggle]);

  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        className={cn(
          "inline-flex max-w-full items-center text-left hover:text-foreground",
          WORK_ROW_BLOCK_CLASS_NAME,
          WORK_ROW_LINE_CLASS_NAME,
          WORK_ROW_GAP_CLASS_NAME,
          MUTED_LABEL_TEXT_CLASS_NAME,
        )}
        style={{ fontSize: `${fontSizePx}px` }}
        onClick={() => onToggle(!open)}
      >
        <span className={WORK_ROW_ICON_SLOT_CLASS_NAME} aria-hidden>
          {live || summary.hasRunningEntry ? (
            <Spinner
              variant={summary.activity === "agent" ? "subagent" : "action"}
              aria-hidden="true"
              className={WORK_ROW_ICON_CLASS_NAME}
            />
          ) : (
            renderGroupIcon(summary, entries)
          )}
        </span>
        <span className="min-w-0 truncate">
          <WorkTextShimmer active={live}>{summary.label}</WorkTextShimmer>
          {summary.latestStep ? <span> · {summary.latestStep}</span> : null}
        </span>
        <DisclosureChevron open={open} className={WORK_ROW_CHEVRON_CLASS_NAME} />
      </button>
      <DisclosureRegion open={open} lazy>
        <div className="tool-group-tree">{renderChildren()}</div>
      </DisclosureRegion>
    </div>
  );
}
