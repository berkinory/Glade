import { useRemoteEnvironments } from "~/environments/remoteEnvironments";
import { remoteHostAvailability } from "~/environments/remoteEnvironmentStatus";
import { ChevronDownIcon, CloudServerIcon, ComputerTerminal01Icon, ServerIcon } from "~/lib/icons";
import { HostStatusDot } from "../../HostStatusDot";
import { ComposerPickerMenuPopup } from "../../chat/ComposerPickerMenuPopup";
import { EnvironmentMenuItems } from "../../chat/EnvironmentMenuItems";
import { Button } from "../../ui/button";
import { Menu, MenuTrigger } from "../../ui/menu";
import { setSettingsMachine, useSettingsMachine } from "./settingsMachine";

// Which machine the agent settings below belong to. Hidden until there is another machine.
export function MachinePicker() {
  const machine = useSettingsMachine();
  const environments = useRemoteEnvironments();
  if (environments.length === 0) return null;
  const Icon = machine.remote
    ? machine.remote.kind === "ssh"
      ? ServerIcon
      : CloudServerIcon
    : ComputerTerminal01Icon;
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button variant="outline" size="sm" className="max-w-56 shrink-0">
            <Icon aria-hidden className="size-3.5 opacity-70" />
            <span className="min-w-0 truncate">{machine.label}</span>
            {machine.remote ? (
              <HostStatusDot tone={remoteHostAvailability(machine.remote).tone} />
            ) : null}
            <ChevronDownIcon aria-hidden className="size-3.5 opacity-60" />
          </Button>
        }
      />
      <ComposerPickerMenuPopup align="end">
        <EnvironmentMenuItems onSelect={setSettingsMachine} />
      </ComposerPickerMenuPopup>
    </Menu>
  );
}
