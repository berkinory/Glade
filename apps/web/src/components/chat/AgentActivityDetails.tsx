import { useState, type ReactNode } from "react";
import {
  formatLiveActivityElapsed,
  formatLiveActivityStateLabel,
  useLiveActivityNow,
} from "../../lib/liveActivityPresentation";
import ChatMarkdown from "../ChatMarkdown";
import type { ExpandedImagePreview } from "./ExpandedImagePreview";
import { type AgentActivityDetail, formatAgentActivityEntryPreview } from "./agentActivity.logic";
import { getChatTranscriptTextStyle } from "./chatTypography";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { DisclosureChevron } from "../ui/DisclosureChevron";

export function AgentActivityDetails({
  detail,
  fontSizePx,
  markdownCwd,
  onImageExpand,
}: {
  detail: AgentActivityDetail;
  fontSizePx: number;
  markdownCwd: string | undefined;
  onImageExpand: (preview: ExpandedImagePreview) => void;
}) {
  const entry = detail.entry;
  const activity = entry.liveActivity;
  const nowMs = useLiveActivityNow(activity);
  const elapsed = activity ? formatLiveActivityElapsed(activity, nowMs) : null;
  const subagent = entry.itemType === "collab_agent_tool_call";
  const prompt = entry.subagentAction?.prompt;
  const result = subagent ? entry.detail : undefined;
  const body = entry.detail ?? formatAgentActivityEntryPreview(entry);
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
      ) : body && !(subagent && body === prompt) ? (
        <div className="max-h-[min(12lh,32vh)] overflow-y-auto overscroll-contain pr-2">
          {renderText(body)}
        </div>
      ) : null}
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
