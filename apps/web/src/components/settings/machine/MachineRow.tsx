import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";

import type { RemoteEnvironment } from "~/environments/remoteEnvironments";
import {
  describeRemoteEnvironment,
  remoteHostAvailability,
} from "~/environments/remoteEnvironmentStatus";
import { BotIcon, CloudServerIcon, EllipsisIcon, ServerIcon } from "~/lib/icons";
import { environmentServerConfigQueryOptions } from "~/lib/serverReactQuery";
import { ComposerPickerMenuPopup } from "../../chat/ComposerPickerMenuPopup";
import { HostStatusDot } from "../../HostStatusDot";
import { Button } from "../../ui/button";
import { Menu, MenuItem, MenuTrigger } from "../../ui/menu";
import { ProviderStack } from "../ProviderStack";
import { SettingsTile } from "../SettingsTile";
import { setSettingsMachine } from "./settingsMachine";

// One SSH host or paired machine: its state, address and the agents installed there, with its
// actions. Manage agents opens Settings → Providers for that machine.
export function MachineRow(props: {
  readonly environment: RemoteEnvironment;
  readonly address: string;
  // Shown next to the menu, such as Reconnect when the machine waits for the user.
  readonly action?: ReactNode;
  readonly menuItems: ReactNode;
  readonly busy?: boolean;
}) {
  const { environment } = props;
  const navigate = useNavigate();
  const status = describeRemoteEnvironment(environment);
  const availability = remoteHostAvailability(environment);
  const config = useQuery({
    ...environmentServerConfigQueryOptions(environment.key),
    enabled: environment.api !== null && status.reachable,
  });
  const agents = (config.data?.providers ?? [])
    .filter((provider) => provider.available)
    .map((provider) => provider.provider);
  const label = environment.host.label;
  const detail = availability.needsUser
    ? (environment.connection?.detail ?? availability.reason)
    : status.label;

  return (
    <div className="flex min-w-0 items-center gap-3 px-3 py-2.5">
      <SettingsTile badge={<HostStatusDot tone={availability.tone} className="size-2" />}>
        {environment.kind === "ssh" ? <ServerIcon /> : <CloudServerIcon />}
      </SettingsTile>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-ui font-medium text-foreground">{label}</span>
          {label === props.address ? null : (
            <span className="truncate font-mono text-ui-xs text-muted-foreground">
              {props.address}
            </span>
          )}
        </span>
        <span
          className={
            availability.needsUser
              ? "block truncate text-ui-sm text-warning"
              : "block truncate text-ui-sm text-muted-foreground"
          }
          title={detail}
        >
          {detail}
        </span>
      </span>
      <ProviderStack providers={agents} />
      {props.action}
      <Menu>
        <MenuTrigger
          render={
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={`More actions for ${label}`}
              disabled={props.busy}
            />
          }
        >
          <EllipsisIcon aria-hidden />
        </MenuTrigger>
        <ComposerPickerMenuPopup align="end">
          <MenuItem
            disabled={!availability.selectable}
            title={availability.selectable ? undefined : availability.reason}
            onClick={() => {
              setSettingsMachine(environment.key);
              void navigate({ to: "/settings", search: { section: "providers" } });
            }}
          >
            <BotIcon aria-hidden className="size-3.5 opacity-70" />
            Manage agents
          </MenuItem>
          {props.menuItems}
        </ComposerPickerMenuPopup>
      </Menu>
    </div>
  );
}
