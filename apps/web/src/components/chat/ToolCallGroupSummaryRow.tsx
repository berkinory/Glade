import { useEffect, useState, type ReactNode } from "react";

import { DisclosureChevron } from "../ui/DisclosureChevron";
import { DisclosureRegion } from "../ui/DisclosureRegion";
import { DISCLOSURE_CLEANUP_BUFFER_MS, DISCLOSURE_TRANSITION_MS } from "~/lib/disclosureMotion";
import { cn } from "~/lib/utils";
import { MUTED_LABEL_TEXT_CLASS_NAME } from "~/surfaceStyles";
import { extractWebFetchUrl } from "../../lib/toolCallLabel";
import { LinkChipIcon } from "../LinkChipIcon";
import type { WorkLogEntry } from "../../session-logic";
import { multiFileEditLabel, type ToolCallGroupSummary } from "./toolCallGroup.logic";
import {
  renderWorkEntryIcon,
  workEntryDisplayText,
  workEntryLeftIcon,
} from "./TimelineWorkEntryRow";

export function ToolCallGroupSummaryRow(props: {
  summary: ToolCallGroupSummary;

  liveEntry?: WorkLogEntry | null;
  open: boolean;
  onToggle: (open: boolean) => void;
  fontSizePx: number;
  renderChildren: () => ReactNode;
}) {
  const { summary, liveEntry, open, onToggle, fontSizePx, renderChildren } = props;
  const [keepChildrenMounted, setKeepChildrenMounted] = useState(open);

  useEffect(() => {
    if (open) {
      setKeepChildrenMounted(true);
      return;
    }
    if (!keepChildrenMounted) return;
    const cleanup = window.setTimeout(
      () => setKeepChildrenMounted(false),
      DISCLOSURE_TRANSITION_MS + DISCLOSURE_CLEANUP_BUFFER_MS,
    );
    return () => window.clearTimeout(cleanup);
  }, [keepChildrenMounted, open]);

  const shouldRenderChildren = open || keepChildrenMounted;

  const iconEntry = liveEntry ?? summary.iconEntry;
  const iconWebFetchUrl = extractWebFetchUrl(iconEntry);

  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        className={cn(
          "inline-flex max-w-full items-center gap-1.5 py-0.5 text-left transition-colors duration-120 hover:text-foreground",
          MUTED_LABEL_TEXT_CLASS_NAME,
        )}
        style={{ fontSize: `${fontSizePx}px` }}
        onClick={() => onToggle(!open)}
      >
        <span className="flex size-4 shrink-0 items-center justify-center" aria-hidden>
          {iconWebFetchUrl ? (
            <LinkChipIcon url={iconWebFetchUrl} className="size-3.5" />
          ) : (
            renderWorkEntryIcon(workEntryLeftIcon(iconEntry), "size-3.5")
          )}
        </span>
        <span className="min-w-0 truncate" data-tool-group-live={liveEntry ? "true" : undefined}>
          {liveEntry
            ? (multiFileEditLabel(liveEntry) ?? workEntryDisplayText(liveEntry))
            : summary.label}
        </span>
        {}
        <DisclosureChevron open={open} className="text-muted-foreground/70" />
      </button>
      <DisclosureRegion open={open}>
        {shouldRenderChildren ? renderChildren() : null}
      </DisclosureRegion>
    </div>
  );
}
