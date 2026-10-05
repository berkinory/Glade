import { useState, type ReactNode } from "react";
import type { TimestampFormat } from "../../appSettings";
import {
  formatLiveActivityElapsed,
  formatLiveActivityStateLabel,
  useLiveActivityNow,
} from "../../lib/liveActivityPresentation";
import { formatShortTimestamp } from "../../timestampFormat";
import ChatMarkdown from "../ChatMarkdown";
import type { ExpandedImagePreview } from "./ExpandedImagePreview";
import { type AgentActivityDetail, formatAgentActivityEntryPreview } from "./agentActivity.logic";
import { getChatTranscriptTextStyle } from "./chatTypography";
import { ProviderTransitionActions } from "./ProviderTransitionActions";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { DisclosureChevron } from "../ui/DisclosureChevron";

export function AgentActivityDetails({
  detail,
  fontSizePx,
  markdownCwd,
  onImageExpand,
  timestampFormat,
}: {
  detail: AgentActivityDetail;
  fontSizePx: number;
  markdownCwd: string | undefined;
  onImageExpand: (preview: ExpandedImagePreview) => void;
  timestampFormat: TimestampFormat;
}) {
  const activity = detail.primaryEntry.liveActivity;
  const nowMs = useLiveActivityNow(activity);
  const elapsed = activity ? formatLiveActivityElapsed(activity, nowMs) : null;
  const subagent = detail.primaryEntry.itemType === "collab_agent_tool_call";
  const prompt = detail.entries.find((entry) => entry.subagentAction?.prompt)?.subagentAction
    ?.prompt;
  const result = subagent ? detail.entries.findLast((entry) => entry.detail)?.detail : undefined;
  const typographyStyle = getChatTranscriptTextStyle(fontSizePx);
  const renderText = (text: string) => (
    <ChatMarkdown
      text={text}
      cwd={markdownCwd}
      style={typographyStyle}
      className="text-chat leading-relaxed text-foreground/88"
      onImageExpand={onImageExpand}
    />
  );

  return (
    <div className="min-w-0 space-y-3 border-l border-border/45 pl-3">
      {detail.primaryEntry.providerTransition ? (
        <ProviderTransitionActions
          operationId={detail.primaryEntry.providerTransition.operationId}
        />
      ) : null}
      {subagent && activity ? (
        <p className="text-ui-xs tabular-nums text-muted-foreground">
          {formatLiveActivityStateLabel(activity.state)}
          {elapsed ? ` · ${elapsed}` : ""}
        </p>
      ) : null}
      {prompt ? (
        <ActivityTextSection title="Prompt">{renderText(prompt)}</ActivityTextSection>
      ) : null}
      {result ? (
        <ActivityTextSection title="Result" initiallyOpen>
          {renderText(result)}
        </ActivityTextSection>
      ) : (
        <div
          className="max-h-[min(12lh,32vh)] space-y-3 overflow-y-auto overscroll-contain pr-2"
          style={typographyStyle}
        >
          {detail.entries.map((entry) => {
            const body = entry.detail ?? formatAgentActivityEntryPreview(entry);
            if (!body || (subagent && body === prompt)) return null;
            return (
              <div
                key={entry.id}
                className="space-y-1.5 border-t border-border/45 pt-3 first:border-t-0 first:pt-0"
              >
                {detail.entries.length > 1 ? (
                  <time
                    dateTime={entry.createdAt}
                    className="text-ui-xs tabular-nums text-muted-foreground"
                  >
                    {formatShortTimestamp(entry.createdAt, timestampFormat)}
                  </time>
                ) : null}
                {renderText(body)}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ActivityTextSection({
  title,
  initiallyOpen = false,
  children,
}: {
  title: string;
  initiallyOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="group flex w-full items-center gap-1.5 rounded-sm text-left text-ui-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-border-focus)]/60">
        <DisclosureChevron open={open} className="group-hover:text-foreground" />
        {title}
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <div className="pt-2">
          <div className="max-h-[min(12lh,32vh)] overflow-y-auto overscroll-contain pr-2">
            {children}
          </div>
        </div>
      </CollapsiblePanel>
    </Collapsible>
  );
}
