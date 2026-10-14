import { remoteHostAvailability } from "~/environments/remoteEnvironmentStatus";
import type { RemoteEnvironment } from "~/environments/remoteEnvironments";
import { ServerStack01Icon } from "~/lib/icons";
import { PanelEmptyState } from "./PanelEmptyState";
import { RemoteEnvironmentStatusChip } from "./RemoteEnvironmentStatusChip";

export function RemoteChatUnavailable({ environment }: { environment: RemoteEnvironment }) {
  const availability = remoteHostAvailability(environment);
  const waiting = availability.tone === "busy" || availability.tone === "connected";
  return (
    <PanelEmptyState
      fill="flex"
      icon={<ServerStack01Icon className="size-8" />}
      title={
        waiting
          ? `Loading chat from ${environment.host.label}`
          : `${environment.host.label} is unavailable`
      }
      description={
        waiting
          ? "Your chat is saved on this host. Messages will appear when the connection is ready."
          : `${availability.reason} Your chat will open automatically when the host connects.`
      }
    >
      <RemoteEnvironmentStatusChip />
    </PanelEmptyState>
  );
}
