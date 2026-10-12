import { BackgroundIcon, BotIcon, SquareFilledIcon } from "~/lib/icons";
import { SubagentAvatar } from "./SubagentAvatar";
import { SubagentStatusIndicator } from "./SubagentStatusIndicator";
import { SubagentRosterSummary } from "./SubagentRosterSummary";
import { useSubagentListExpanded } from "./subagentListExpanded";
import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { DisclosureChevron } from "../ui/DisclosureChevron";
import { DisclosureRegion } from "../ui/DisclosureRegion";
import type {
  ComposerSubagentStripItem,
  ComposerSubagentStripRow,
} from "./ComposerSubagentStrip.logic";
import {
  ComposerStackedPanelHeaderRow,
  ComposerStackedPanelRowLabel,
  ComposerStackedPanelRowMain,
} from "./ComposerStackedPanelContent";
import { ComposerStackedPanel } from "./ComposerStackedPanel";
import {
  COMPOSER_STACKED_PANEL_BODY_PADDING_CLASS_NAME,
  COMPOSER_STACKED_PANEL_ICON_BUTTON_CLASS_NAME,
  COMPOSER_STACKED_PANEL_ICON_CLASS_NAME,
  COMPOSER_STACKED_PANEL_SCROLL_REGION_CLASS_NAME,
} from "./composerStackedPanelStyles";
interface ComposerSubagentStripProps {
  items: ReadonlyArray<ComposerSubagentStripRow>;
  onOpenThread: (threadId: ThreadId) => void;
  onBackgroundItem?: ((item: ComposerSubagentStripItem) => void) | undefined;
  onStopItem?: ((item: ComposerSubagentStripItem) => void) | undefined;
  onStopAll?: (() => void) | undefined;
  attachedToPrevious?: boolean;
}
export const ComposerSubagentStrip = function ComposerSubagentStrip({
  items,
  onOpenThread,
  onBackgroundItem,
  onStopItem,
  onStopAll,
  attachedToPrevious: attachedToPreviousProp,
}: ComposerSubagentStripProps) {
  const attachedToPrevious = attachedToPreviousProp ?? false;
  const subagentItems = items.filter(
    (item): item is ComposerSubagentStripItem => item.kind === "subagent",
  );
  const runningCount = subagentItems.filter((item) => item.isActive).length;
  const [expanded, setExpanded] = useSubagentListExpanded();
  return (
    <ComposerStackedPanel
      passthroughSideMargins
      attachedToPrevious={attachedToPrevious}
      data-testid="composer-subagent-strip"
    >
      <ComposerStackedPanelHeaderRow>
        <ComposerStackedPanelRowMain>
          <BotIcon className={COMPOSER_STACKED_PANEL_ICON_CLASS_NAME} />
          <ComposerStackedPanelRowLabel tone="meta">Subagents</ComposerStackedPanelRowLabel>
        </ComposerStackedPanelRowMain>
        {onStopAll && runningCount > 1 ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className={cn("shrink-0", COMPOSER_STACKED_PANEL_ICON_BUTTON_CLASS_NAME)}
            onClick={onStopAll}
            aria-label="Stop all subagents"
            title="Stop all running subagents"
          >
            <SquareFilledIcon className="size-3" />
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className={cn("shrink-0", COMPOSER_STACKED_PANEL_ICON_BUTTON_CLASS_NAME)}
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          aria-label={expanded ? "Show subagent avatars" : "Show subagent list"}
          title={expanded ? "Show subagent avatars" : "Show subagent list"}
        >
          <DisclosureChevron open={expanded} />
        </Button>
      </ComposerStackedPanelHeaderRow>
      <DisclosureRegion open={!expanded}>
        <div className="px-1.5 pb-1">
          <SubagentRosterSummary
            threadIds={subagentItems.map((item) => item.threadId)}
            runningCount={runningCount}
            doneCount={subagentItems.length - runningCount}
            onExpand={() => setExpanded(true)}
            className="px-1 py-1"
          />
        </div>
      </DisclosureRegion>

      <DisclosureRegion open={expanded}>
        <div
          className={cn(
            "space-y-0",
            COMPOSER_STACKED_PANEL_BODY_PADDING_CLASS_NAME,
            COMPOSER_STACKED_PANEL_SCROLL_REGION_CLASS_NAME,
          )}
        >
          {subagentItems.map((item) => (
            <div
              key={item.key}
              data-testid="composer-subagent-row"
              data-viewed={item.isViewed || undefined}
              className={cn(
                "group/subagent-row -mx-1 flex w-[calc(100%+0.5rem)] min-w-0 items-center gap-1 rounded-md px-1 py-1 transition-colors hover:bg-[var(--color-background-button-secondary-hover)]",
                item.isViewed && "bg-[var(--color-background-button-secondary)]",
              )}
            >
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
                title={item.fullLabel}
                onClick={() => onOpenThread(item.threadId)}
              >
                <SubagentAvatar threadId={item.threadId} />
                <span className="min-w-0 flex-1 truncate text-ui font-medium text-foreground/85">
                  <span>{item.primaryLabel}</span>
                  {item.modelLabel ? (
                    <span className="ml-1.5 text-ui-sm font-normal text-muted-foreground/45">
                      {item.modelLabel}
                    </span>
                  ) : null}
                  {item.isBackground ? (
                    <span className="ml-1.5 text-ui-sm font-normal text-muted-foreground/45">
                      background
                    </span>
                  ) : null}
                </span>
              </button>
              {item.isActive && !item.isBackground && onBackgroundItem ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className={cn(
                    "shrink-0 opacity-0 transition-opacity group-focus-within/subagent-row:opacity-100 group-hover/subagent-row:opacity-100",
                    COMPOSER_STACKED_PANEL_ICON_BUTTON_CLASS_NAME,
                  )}
                  onClick={() => onBackgroundItem(item)}
                  aria-label="Run in background (ctrl+b)"
                  title="Run in background (ctrl+b)"
                >
                  <BackgroundIcon className="size-3" />
                </Button>
              ) : null}
              <SubagentStatusIndicator
                variant="text"
                statusKind={item.statusKind}
                statusLabel={item.statusLabel}
                onStop={item.isActive && onStopItem ? () => onStopItem(item) : undefined}
              />
            </div>
          ))}
        </div>
      </DisclosureRegion>
    </ComposerStackedPanel>
  );
};
