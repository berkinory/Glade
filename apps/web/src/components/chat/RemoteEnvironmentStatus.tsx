import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useActiveEnvironment } from "~/environments/activeEnvironment";
import {
  connectRemoteEnvironment,
  useRemoteEnvironments,
  type RemoteEnvironment,
} from "~/environments/remoteEnvironments";
import {
  describeRemoteEnvironment,
  remoteHostAvailability,
  remoteMachineSettingsSection,
  type RemoteEnvironmentStatus,
} from "~/environments/remoteEnvironmentStatus";
import { CloudServerIcon, ServerIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import type { WsTransportState } from "~/wsTransportEvents";
import { HostStatusDot } from "../HostStatusDot";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { COMPOSER_PICKER_TRIGGER_TEXT_CLASS_NAME } from "./composerPickerStyles";
import { ENVIRONMENT_ROW_CLASS_NAME } from "./environment/EnvironmentRow";

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

export function RemoteEnvironmentStatus({ variant }: { variant: "composer" | "panel" }) {
  const activeEnvironment = useActiveEnvironment();
  const environment = useRemoteEnvironments().find(
    (candidate) => candidate.key === activeEnvironment,
  );
  const transport = useHostTransport(environment);
  const navigate = useNavigate();
  if (!environment || (variant === "panel" && environment.kind !== "ssh")) return null;
  const status = chipStatus(environment, transport);
  const availability = remoteHostAvailability(environment);
  const tone = status.tone === "busy" ? "busy" : availability.tone;
  // A host that needs the user is fixed in its settings; an unreachable one can be retried here.
  const action = availability.needsUser
    ? () =>
        void navigate({
          to: "/settings",
          search: { section: remoteMachineSettingsSection(environment.kind) },
        })
    : status.reachable
      ? null
      : () => void connectRemoteEnvironment(environment).catch(() => undefined);
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
              variant === "panel"
                ? ENVIRONMENT_ROW_CLASS_NAME
                : "inline-flex h-7 min-w-0 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-muted-foreground",
              variant === "composer" && COMPOSER_PICKER_TRIGGER_TEXT_CLASS_NAME,
              action ? "cursor-pointer hover:bg-accent hover:text-foreground" : "cursor-default",
            )}
          >
            <span className="relative inline-flex size-3.5 shrink-0 items-center justify-center">
              {environment.kind === "ssh" ? (
                <ServerIcon aria-hidden className="size-3.5" />
              ) : (
                <CloudServerIcon aria-hidden className="size-3.5" />
              )}
              <HostStatusDot
                tone={tone}
                className="absolute -right-0.5 -bottom-0.5 ring-2 ring-background"
              />
            </span>
            <span className={variant === "panel" ? "min-w-0 flex-1 truncate" : "max-w-32 truncate"}>
              {environment.host.label}
            </span>
            {variant === "panel" ? (
              <span className="shrink-0 text-ui-xs text-muted-foreground">{status.label}</span>
            ) : null}
          </button>
        }
      />
      <TooltipPopup side="top" className="max-w-72 whitespace-pre-line">
        {[
          status.label,
          detail,
          availability.needsUser
            ? `Click to open ${environment.kind === "ssh" ? "SSH" : "Remote access"} settings.`
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
