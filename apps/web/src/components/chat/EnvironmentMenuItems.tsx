import { useNavigate } from "@tanstack/react-router";
import { LOCAL_ENVIRONMENT, type EnvironmentKey } from "~/environments/environmentKey";
import { useRemoteEnvironments } from "~/environments/remoteEnvironments";
import { remoteHostAvailability } from "~/environments/remoteEnvironmentStatus";
import { ComputerTerminal01Icon, PlusIcon, ServerStack01Icon } from "~/lib/icons";
import { HostStatusDot } from "../HostStatusDot";
import { MenuItem, MenuSeparator, MenuSub, MenuSubTrigger } from "../ui/menu";
import { ComposerPickerMenuSubPopup } from "./ComposerPickerMenuPopup";

// Where something runs: this machine, or one of the saved SSH hosts under "SSH". The same items
// serve every place that picks a machine, so they read and behave alike.
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
      <MenuSub>
        <MenuSubTrigger>
          <ServerStack01Icon aria-hidden className="size-3.5 opacity-70" />
          SSH
        </MenuSubTrigger>
        <ComposerPickerMenuSubPopup>
          {environments.map((environment) => {
            const availability = remoteHostAvailability(environment);
            const enabled = availability.selectable || availability.needsUser;
            return (
              <MenuItem
                key={environment.key}
                disabled={!enabled}
                title={availability.reason}
                onClick={() =>
                  availability.selectable
                    ? props.onSelect(environment.key)
                    : void navigate({ to: "/settings", search: { section: "ssh" } })
                }
              >
                <ServerStack01Icon aria-hidden className="size-3.5 opacity-70" />
                <span className="min-w-0 flex-1 truncate">{environment.host.label}</span>
                <HostStatusDot tone={availability.tone} />
              </MenuItem>
            );
          })}
          {environments.length > 0 ? <MenuSeparator /> : null}
          <MenuItem onClick={() => void navigate({ to: "/settings", search: { section: "ssh" } })}>
            <PlusIcon aria-hidden className="size-3.5 opacity-70" />
            Add SSH host…
          </MenuItem>
        </ComposerPickerMenuSubPopup>
      </MenuSub>
    </>
  );
}
