import type { ReactNode } from "react";

import { DisclosureChevron } from "../ui/DisclosureChevron";
import { DisclosureRegion } from "../ui/DisclosureRegion";
import { Spinner } from "../ui/spinner";
import { cn } from "~/lib/utils";
import { MUTED_LABEL_TEXT_CLASS_NAME } from "~/surfaceStyles";
import { LinkChipIcon } from "../LinkChipIcon";
import {
  BotIcon,
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
  WORK_ROW_GAP_CLASS_NAME,
  WORK_ROW_ICON_CLASS_NAME,
  WORK_ROW_ICON_SLOT_CLASS_NAME,
  WORK_ROW_LINE_CLASS_NAME,
} from "./workRowStyles";
import { WorkTextShimmer } from "./WorkTextShimmer";

const ACTIVITY_ICONS: Record<Exclude<ToolCallGroupActivity, "tools">, IconComponent> = {
  edit: PencilEdit02Icon,
  command: ComputerTerminal01Icon,
  explore: SearchIcon,
  browse: Globe02Icon,
  computer: CursorInWindowIcon,
  agent: BotIcon,
  image_view: ViewIcon,
  image_generation: Image01Icon,
};

function renderGroupIcon(summary: ToolCallGroupSummary) {
  const { activity, iconEntry } = summary;
  if (activity === "mixed") return renderWorkEntryIcon(ToolsIcon, WORK_ROW_ICON_CLASS_NAME);
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
  live?: boolean;
  open: boolean;
  onToggle: (open: boolean) => void;
  fontSizePx: number;
  renderChildren: () => ReactNode;
}) {
  const { summary, live = false, open, onToggle, fontSizePx, renderChildren } = props;

  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        className={cn(
          "inline-flex max-w-full items-center text-left transition-colors duration-100 hover:text-foreground",
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
            <Spinner variant="working" aria-hidden="true" className={WORK_ROW_ICON_CLASS_NAME} />
          ) : (
            renderGroupIcon(summary)
          )}
        </span>
        <span className="min-w-0 truncate">
          <WorkTextShimmer active={live}>{summary.label}</WorkTextShimmer>
          {summary.latestStep ? <span> · {summary.latestStep}</span> : null}
        </span>
        <DisclosureChevron open={open} className="text-muted-foreground/70" />
      </button>
      <DisclosureRegion open={open} lazy>
        <div className="tool-group-tree">{renderChildren()}</div>
      </DisclosureRegion>
    </div>
  );
}
