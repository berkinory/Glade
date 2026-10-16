import { PROVIDER_DESCRIPTORS } from "@glade/shared/provider/providerMetadata";
import { useState, type ReactNode } from "react";

import { formatTimestamp } from "../../timestampFormat";
import type { WorkLogEntry, WorkLogMonitorNotification } from "../../workLog.types";
import { cn } from "~/lib/utils";
import {
  WORK_ROW_CHEVRON_CLASS_NAME,
  WORK_ROW_DETAILS_INSET_CLASS_NAME,
  WORK_ROW_GAP_CLASS_NAME,
} from "./workRowStyles";
import { ToolCallDetailsContent } from "./ToolCallDetailsDialog";
import { DisclosureChevron } from "../ui/DisclosureChevron";
import { DisclosureRegion } from "../ui/DisclosureRegion";

type TimelineWorkEntry = WorkLogEntry;

export function AgentActivityOpenSurface(props: {
  canOpen: boolean;
  children: ReactNode;

  onHover?: (() => void) | undefined;
  onOpen?: (() => void) | undefined;
  title?: string | undefined;
  dataToolDetailTrigger?: boolean | undefined;
}) {
  const className = cn(
    "group/tool-row flex w-full items-center text-left",
    WORK_ROW_GAP_CLASS_NAME,
    props.canOpen ? "cursor-pointer focus-visible:outline-none" : "cursor-default",
  );

  return props.canOpen ? (
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
}) {
  return (
    <div className="space-y-1.5" data-monitor-event-details="true">
      <time className="text-ui-xs text-muted-foreground/56" dateTime={props.createdAt}>
        {formatTimestamp(props.createdAt)}
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
  // Opens the details when it changes to a new value, such as for a reveal of this tool call.
  revealSignal?: number | undefined;
}) {
  const summaryClassName =
    props.summaryClassName ??
    cn(
      "group/tool-row flex w-full items-center text-left",
      WORK_ROW_GAP_CLASS_NAME,
      "cursor-pointer focus-visible:outline-none",
    );
  const [open, setOpen] = useState(false);
  // Starts unhandled, so a row that mounts during a reveal (its group just opened) opens too.
  const [handledReveal, setHandledReveal] = useState<number | undefined>(undefined);
  if (props.revealSignal !== handledReveal) {
    setHandledReveal(props.revealSignal);
    if (props.revealSignal !== undefined) setOpen(true);
  }

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
        className={cn(
          WORK_ROW_CHEVRON_CLASS_NAME,
          "group-hover/tool-row:text-foreground group-hover/file-row:text-foreground group-focus-visible/tool-row:text-foreground group-focus-visible/file-row:text-foreground",
        )}
      />
    </button>
  );

  return (
    <div className="group/tool-details min-w-0">
      {summaryButton}
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
