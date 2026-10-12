import { PROVIDER_DESCRIPTORS } from "@glade/shared/provider/providerMetadata";
import { useState, type ReactElement, type ReactNode } from "react";

import type { TimestampFormat } from "../../appSettings";
import { formatTimestamp } from "../../timestampFormat";
import type { WorkLogEntry, WorkLogMonitorNotification } from "../../workLog.types";
import { cn } from "~/lib/utils";
import { WORK_ROW_DETAILS_INSET_CLASS_NAME, WORK_ROW_GAP_CLASS_NAME } from "./workRowStyles";
import { ToolCallDetailsContent } from "./ToolCallDetailsDialog";
import { DisclosureChevron } from "../ui/DisclosureChevron";
import { DisclosureRegion } from "../ui/DisclosureRegion";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

type TimelineWorkEntry = WorkLogEntry;

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

export function AgentActivityOpenSurface(props: {
  canOpen: boolean;
  children: ReactNode;

  onHover?: (() => void) | undefined;
  onOpen?: (() => void) | undefined;
  title?: string | undefined;

  tooltip?: ReactNode;
  dataToolDetailTrigger?: boolean | undefined;
}) {
  const className = cn(
    "group/tool-row flex w-full items-center text-left transition-[opacity,translate] duration-120",
    WORK_ROW_GAP_CLASS_NAME,
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

export function ProviderContextLifecycleDetails(props: {
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

export function MonitorEventDetails(props: {
  notification: WorkLogMonitorNotification;
  createdAt: string;
  timestampFormat: TimestampFormat;
}) {
  return (
    <div className="space-y-1.5" data-monitor-event-details="true">
      <time className="text-ui-xs text-muted-foreground/56" dateTime={props.createdAt}>
        {formatTimestamp(props.createdAt, props.timestampFormat)}
      </time>
      {props.notification.output ? (
        <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border/45 bg-background/60 px-3 py-2.5 font-chat-code text-chat-code leading-relaxed text-foreground/84">
          {props.notification.output}
        </pre>
      ) : null}
    </div>
  );
}

export function ToolDetailsDisclosure(props: {
  children: ReactNode;
  dataFileChangeRow?: boolean | undefined;
  details?: TimelineWorkEntry["toolDetails"] | undefined;
  activity?: TimelineWorkEntry["liveActivity"] | undefined;
  toolKind?: TimelineWorkEntry["toolKind"] | undefined;
  detailContent?: ReactNode;
  summaryClassName?: string | undefined;
  tooltip?: ReactNode;
}) {
  const summaryClassName =
    props.summaryClassName ??
    cn(
      "group/tool-row flex w-full items-center text-left transition-[opacity,translate] duration-120",
      WORK_ROW_GAP_CLASS_NAME,
      "cursor-pointer focus-visible:outline-none",
    );
  const [open, setOpen] = useState(false);

  const summaryButton = (
    <button
      type="button"
      className={summaryClassName}
      aria-expanded={open}
      data-file-change-row={props.dataFileChangeRow ? "true" : undefined}
      data-tool-detail-trigger="true"
      onClick={() => setOpen(!open)}
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
      <DisclosureRegion
        open={open}
        lazy
        contentClassName={cn("min-w-0 pt-2", WORK_ROW_DETAILS_INSET_CLASS_NAME)}
      >
        <div data-tool-details-inline="true">
          {props.detailContent ?? (
            <ToolCallDetailsContent
              details={props.details}
              activity={props.activity}
              toolKind={props.toolKind}
            />
          )}
        </div>
      </DisclosureRegion>
    </div>
  );
}
