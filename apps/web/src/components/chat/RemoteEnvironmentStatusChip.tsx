import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useActiveEnvironment } from "~/environments/activeEnvironment";
import {
  connectRemoteHost,
  useRemoteEnvironments,
  type RemoteEnvironment,
} from "~/environments/remoteEnvironments";
import {
  describeRemoteEnvironment,
  remoteHostAvailability,
  type RemoteEnvironmentStatus,
} from "~/environments/remoteEnvironmentStatus";
import { ServerStack01Icon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import type { WsTransportState } from "~/wsTransportEvents";
import { HostStatusDot } from "../HostStatusDot";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { COMPOSER_PICKER_TRIGGER_TEXT_CLASS_NAME } from "./composerPickerStyles";

// The host's own transport can be reconnecting or waiting on a busy server while the SSH tunnel is
// up, so both feed the status.
function useHostTransport(environment: RemoteEnvironment | undefined) {
  const transport = environment?.api?.transport ?? null;
  const [state, setState] = useState<WsTransportState | null>(null);
  const [unresponsive, setUnresponsive] = useState(false);
  useEffect(() => {
    setState(null);
    setUnresponsive(false);
    if (!transport) return;
    const stopState = transport.onStateChange(setState, { replayCurrent: true });
    const stopStatus = transport.onConnectionStatusChange(
      (snapshot) => setUnresponsive(snapshot.serverUnresponsive),
      { replayCurrent: true },
    );
    return () => {
      stopState();
      stopStatus();
    };
  }, [transport]);
  return { state, unresponsive };
}

function chipStatus(
  environment: RemoteEnvironment,
  transport: ReturnType<typeof useHostTransport>,
): RemoteEnvironmentStatus {
  const status = describeRemoteEnvironment(environment);
  if (status.tone !== "connected") return status;
  if (transport.state === "connecting" || transport.state === "closed") {
    return { label: "Reconnecting…", tone: "busy", reachable: true };
  }
  if (transport.unresponsive) {
    return { label: "Not answering yet", tone: "busy", reachable: true };
  }
  return status;
}

// Where the chat on screen runs, when that is an SSH host: its name and a status dot beside the
// composer's controls. Hovering explains the state; clicking acts only when the user can fix it.
export function RemoteEnvironmentStatusChip() {
  const activeEnvironment = useActiveEnvironment();
  const environment = useRemoteEnvironments().find(
    (candidate) => candidate.key === activeEnvironment,
  );
  const transport = useHostTransport(environment);
  const navigate = useNavigate();
  if (!environment) return null;
  const status = chipStatus(environment, transport);
  const availability = remoteHostAvailability(environment);
  const tone = status.tone === "busy" ? "busy" : availability.tone;
  // A host that needs the user is fixed in the SSH settings; an unreachable one can be retried here.
  const action = availability.needsUser
    ? () => void navigate({ to: "/settings", search: { section: "ssh" } })
    : status.reachable
      ? null
      : () => void connectRemoteHost(environment.host.id).catch(() => undefined);
  const detail = status.tone === "connected" ? null : environment.connection?.detail;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={`Running on ${environment.host.label}: ${status.label}`}
            aria-disabled={action === null}
            onClick={action ?? undefined}
            className={cn(
              "inline-flex h-7 min-w-0 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-muted-foreground",
              COMPOSER_PICKER_TRIGGER_TEXT_CLASS_NAME,
              action ? "cursor-pointer hover:bg-accent hover:text-foreground" : "cursor-default",
            )}
          >
            <span className="relative inline-flex size-3.5 shrink-0 items-center justify-center">
              <ServerStack01Icon aria-hidden className="size-3.5" />
              <HostStatusDot
                tone={tone}
                className="absolute -right-0.5 -bottom-0.5 ring-2 ring-background"
              />
            </span>
            <span className="max-w-32 truncate">{environment.host.label}</span>
          </button>
        }
      />
      <TooltipPopup side="top" className="max-w-72 whitespace-pre-line">
        {[
          status.label,
          detail,
          availability.needsUser
            ? "Click to open SSH settings."
            : action
              ? "Click to reconnect."
              : null,
        ]
          .filter(Boolean)
          .join("\n")}
      </TooltipPopup>
    </Tooltip>
  );
}
