import { useState } from "react";
import { useActiveEnvironment } from "~/environments/activeEnvironment";
import type { EnvironmentKey } from "~/environments/environmentKey";
import {
  connectRemoteHost,
  useRemoteEnvironments,
  type RemoteEnvironment,
} from "~/environments/remoteEnvironments";
import { describeRemoteEnvironment } from "~/environments/remoteEnvironmentStatus";
import { ComputerTerminal01Icon, ServerStack01Icon } from "~/lib/icons";
import { toastManager } from "../ui/toast";
import { Menu, MenuTrigger } from "../ui/menu";
import { ComposerPickerMenuPopup } from "./ComposerPickerMenuPopup";
import { EnvironmentMenuItems } from "./EnvironmentMenuItems";
import { PickerTriggerButton } from "./PickerTriggerButton";

// The trigger shows progress only while a picked host is still getting ready.
function pendingLabel(environment: RemoteEnvironment): string | null {
  const status = describeRemoteEnvironment(environment);
  return status.tone === "busy" && !status.reachable ? status.label : null;
}

// Where a new chat runs: this machine or one of the saved SSH hosts. Picking a host that is not
// connected connects it first, installing Glade there when needed.
export function EnvironmentPicker(props: {
  readonly onSelectEnvironment: (environmentKey: EnvironmentKey) => Promise<void>;
  readonly triggerClassName?: string;
}) {
  const activeEnvironment = useActiveEnvironment();
  const environments = useRemoteEnvironments();
  const [pendingKey, setPendingKey] = useState<EnvironmentKey | null>(null);
  const activeRemote = environments.find((environment) => environment.key === activeEnvironment);
  const pendingRemote = environments.find((environment) => environment.key === pendingKey);
  const pendingProgress = pendingRemote ? pendingLabel(pendingRemote) : null;

  const select = async (environmentKey: EnvironmentKey, hostId: string | null) => {
    setPendingKey(environmentKey);
    try {
      if (hostId) await connectRemoteHost(hostId);
      await props.onSelectEnvironment(environmentKey);
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Could not switch the chat",
        description: error instanceof Error ? error.message : "Try again.",
      });
    } finally {
      setPendingKey(null);
    }
  };

  const label = pendingRemote
    ? `${pendingRemote.host.label}${pendingProgress ? ` · ${pendingProgress}` : ""}`
    : (activeRemote?.host.label ?? "Local");

  return (
    <Menu>
      <MenuTrigger
        render={
          <PickerTriggerButton
            compact
            variant="ghost"
            disabled={pendingKey !== null}
            className={props.triggerClassName}
            icon={
              activeRemote || pendingRemote ? (
                <ServerStack01Icon aria-hidden className="size-3.5" />
              ) : (
                <ComputerTerminal01Icon aria-hidden className="size-3.5" />
              )
            }
            label={label}
          />
        }
      />
      <ComposerPickerMenuPopup align="start" side="top">
        <EnvironmentMenuItems
          onSelect={(environmentKey) =>
            void select(
              environmentKey,
              environments.find((environment) => environment.key === environmentKey)?.host.id ??
                null,
            )
          }
        />
      </ComposerPickerMenuPopup>
    </Menu>
  );
}
