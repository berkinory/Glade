import { PROVIDER_DISPLAY_NAMES } from "@glade/contracts/provider/model";
import type { WorkLogEntry } from "../../workLog.types";
import { ProviderIcon } from "../ProviderIcon";
import { ConversationDivider } from "./ConversationDivider";
import { useState, type ReactNode } from "react";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { DisclosureChevron } from "../ui/DisclosureChevron";
import { Spinner } from "../ui/spinner";

export function ProviderTransitionDivider({
  entry,
  detailContent,
}: {
  entry: WorkLogEntry;
  detailContent: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const transition = entry.providerTransition;
  const destination = transition
    ? PROVIDER_DISPLAY_NAMES[transition.destination.provider]
    : "another provider";
  const label = !transition
    ? "Provider transition"
    : transition.stage === "delivered"
      ? `Continued with ${destination}`
      : transition.stage === "ready"
        ? `Ready to continue with ${destination}`
        : transition.stage === "preparing"
          ? `Preparing continuation with ${destination}`
          : transition.stage === "failed"
            ? `Could not continue with ${destination}`
            : transition.stage === "cancelled"
              ? "Continuation cancelled"
              : transition.stage === "uncertain"
                ? `Continuation with ${destination} needs review`
                : `Continuing with ${destination}`;
  const content = (
    <>
      {transition?.stage === "preparing" ? <Spinner className="size-4" /> : null}
      {transition ? (
        <ProviderIcon provider={transition.source.provider} className="size-4 shrink-0" />
      ) : null}
      <span className="truncate">{label}</span>
      {transition ? (
        <ProviderIcon provider={transition.destination.provider} className="size-4 shrink-0" />
      ) : null}
    </>
  );
  const className =
    "inline-flex min-w-0 shrink items-center gap-2 text-ui font-normal text-[var(--color-text-accent)]";
  if (transition?.stage === "delivered" || !detailContent) {
    return (
      <ConversationDivider kind="handoff">
        <span className={className}>{content}</span>
      </ConversationDivider>
    );
  }
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <ConversationDivider kind="handoff">
        <CollapsibleTrigger
          title={entry.label}
          className={`${className} rounded-sm transition-opacity duration-100 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-border-focus)]/60`}
        >
          {content}
          <DisclosureChevron open={open} />
        </CollapsibleTrigger>
      </ConversationDivider>
      <CollapsiblePanel>
        <div className="min-w-0 pb-3 pt-1">{detailContent}</div>
      </CollapsiblePanel>
    </Collapsible>
  );
}
