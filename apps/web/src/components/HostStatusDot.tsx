import { cn } from "~/lib/utils";
import type { RemoteHostAvailability } from "~/environments/remoteEnvironmentStatus";

const TONE_CLASS_NAME: Record<RemoteHostAvailability["tone"], string> = {
  connected: "bg-success",
  busy: "bg-warning animate-pulse",
  offline: "bg-muted-foreground/45",
  attention: "bg-destructive",
};

// An SSH host's state wherever the host is shown: green ready, amber getting there, grey unreachable,
// red waiting for the user.
export function HostStatusDot(props: {
  readonly tone: RemoteHostAvailability["tone"];
  readonly className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn("size-1.5 shrink-0 rounded-full", TONE_CLASS_NAME[props.tone], props.className)}
    />
  );
}
