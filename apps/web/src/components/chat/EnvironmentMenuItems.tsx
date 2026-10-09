import { useNavigate } from "@tanstack/react-router";
import { LOCAL_ENVIRONMENT, type EnvironmentKey } from "~/environments/environmentKey";
import { useRemoteEnvironments, type RemoteEnvironment } from "~/environments/remoteEnvironments";
import {
  remoteHostAvailability,
  remoteMachineSettingsSection,
} from "~/environments/remoteEnvironmentStatus";
import type { IconComponent } from "~/lib/iconComponent";
import { ComputerTerminal01Icon, LaptopIcon, PlusIcon, ServerStack01Icon } from "~/lib/icons";
import { HostStatusDot } from "../HostStatusDot";
import { MenuItem, MenuSeparator, MenuSub, MenuSubTrigger } from "../ui/menu";
import { ComposerPickerMenuSubPopup } from "./ComposerPickerMenuPopup";

const GROUPS = [
  { kind: "ssh", label: "SSH", icon: ServerStack01Icon, addLabel: "Add SSH host…" },
  { kind: "paired", label: "Paired", icon: LaptopIcon, addLabel: "Pair with a machine…" },
] as const satisfies ReadonlyArray<{
  kind: RemoteEnvironment["kind"];
  label: string;
  icon: IconComponent;
  addLabel: string;
}>;

// Where something runs: this machine, a saved SSH host under "SSH", or another machine's Glade under
// "Paired". The same items serve every place that picks a machine, so they read and behave alike.
export function EnvironmentMenuItems(props: {
  readonly onSelect: (environmentKey: EnvironmentKey) => void;
}) {
  const environments = useRemoteEnvironments();
  const navigate = useNavigate();
  return (
    <>
      <MenuItem onClick={() => props.onSelect(LOCAL_ENVIRONMENT)}>
        <ComputerTerminal01Icon aria-hidden className="size-3.5 opacity-70" />
        Local
      </MenuItem>
      {GROUPS.map((group) => {
        const members = environments.filter((environment) => environment.kind === group.kind);
        const openSettings = () =>
          void navigate({
            to: "/settings",
            search: { section: remoteMachineSettingsSection(group.kind) },
          });
        return (
          <MenuSub key={group.kind}>
            <MenuSubTrigger>
              <group.icon aria-hidden className="size-3.5 opacity-70" />
              {group.label}
            </MenuSubTrigger>
            <ComposerPickerMenuSubPopup>
              {members.map((environment) => {
                const availability = remoteHostAvailability(environment);
                return (
                  <MenuItem
                    key={environment.key}
                    disabled={!availability.selectable && !availability.needsUser}
                    title={availability.reason}
                    onClick={() =>
                      availability.selectable ? props.onSelect(environment.key) : openSettings()
                    }
                  >
                    <group.icon aria-hidden className="size-3.5 opacity-70" />
                    <span className="min-w-0 flex-1 truncate">{environment.host.label}</span>
                    <HostStatusDot tone={availability.tone} />
                  </MenuItem>
                );
              })}
              {members.length > 0 ? <MenuSeparator /> : null}
              <MenuItem onClick={openSettings}>
                <PlusIcon aria-hidden className="size-3.5 opacity-70" />
                {group.addLabel}
              </MenuItem>
            </ComposerPickerMenuSubPopup>
          </MenuSub>
        );
      })}
    </>
  );
}
