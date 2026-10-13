import { PROVIDER_DISPLAY_NAMES } from "@glade/contracts/provider/model";
import type { WorkLogEntry } from "../../workLog.types";
import { ProviderIcon } from "../ProviderIcon";
import { ConversationDivider } from "./ConversationDivider";

export function ProviderTransitionDivider({ entry }: { entry: WorkLogEntry }) {
  const transition = entry.providerTransition;
  const destination = transition
    ? PROVIDER_DISPLAY_NAMES[transition.destination.provider]
    : "another provider";
  const label = !transition
    ? "Provider transition"
    : transition.stage === "delivered"
      ? transition.strategy === "resumed"
        ? `Resumed ${destination}`
        : `Continued with ${destination}`
      : transition.stage === "pending"
        ? `Switching to ${destination} with your next message`
        : transition.stage === "cancelled"
          ? "Switch cancelled"
          : `Continuation with ${destination} needs review`;
  return (
    <ConversationDivider kind="handoff">
      <span className="inline-flex min-w-0 shrink items-center gap-2 text-ui font-normal text-[var(--color-text-accent)]">
        {transition ? (
          <ProviderIcon provider={transition.source.provider} className="size-4 shrink-0" />
        ) : null}
        <span className="truncate">{label}</span>
        {transition ? (
          <ProviderIcon provider={transition.destination.provider} className="size-4 shrink-0" />
        ) : null}
      </span>
    </ConversationDivider>
  );
}
