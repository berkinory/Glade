import type { DesktopSshHost, DesktopSshHostInput } from "@glade/contracts/ipc/sshHosts";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  connectRemoteHost,
  repairRemoteHost,
  removeRemoteHost,
  saveRemoteHost,
  useRemoteEnvironments,
  type RemoteEnvironment,
} from "~/environments/remoteEnvironments";
import { remoteHostAvailability } from "~/environments/remoteEnvironmentStatus";
import { Delete02Icon, EllipsisIcon, PencilEdit02Icon, PlusIcon, RefreshCwIcon } from "~/lib/icons";
import { HostStatusDot } from "../HostStatusDot";
import { readLocalNativeApi } from "~/nativeApi";
import { Button } from "../ui/button";
import { ComposerPickerMenuPopup } from "../chat/ComposerPickerMenuPopup";
import { Menu, MenuItem, MenuTrigger } from "../ui/menu";
import { toastManager } from "../ui/toast";
import { SshHostDialog } from "./SshHostDialog";
import {
  SettingsCard,
  SettingsEmptyState,
  SettingsListRow,
  SettingsSectionShell,
} from "./SettingsPanelPrimitives";

// Electron prefixes errors thrown across IPC with the channel; the user only needs the message.
function ipcErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  return error.message.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/u, "");
}

function hostAddress(host: DesktopSshHost): string {
  return host.port === null ? host.destination : `${host.destination}:${host.port}`;
}

function reportConnectFailure(host: DesktopSshHost, error: unknown): void {
  toastManager.add({
    type: "error",
    title: `Could not connect to ${host.label}`,
    description: ipcErrorMessage(error, "Try again."),
  });
}

export function SshHostsSettingsPanel() {
  const api = window.desktopBridge?.sshHosts;
  const environments = useRemoteEnvironments();
  const [dialog, setDialog] = useState<{ readonly host: DesktopSshHost | null } | null>(null);
  const discoveredQuery = useQuery({
    queryKey: ["desktop", "ssh-discovered-hosts"],
    queryFn: () => api?.discover() ?? Promise.resolve([]),
    enabled: api !== undefined,
  });
  const removeHost = useMutation({ mutationFn: removeRemoteHost });

  if (!api) {
    return (
      <SettingsEmptyState>SSH hosts are available in the Glade desktop app.</SettingsEmptyState>
    );
  }

  const savedDestinations = new Set(
    environments.map((environment) => environment.host.destination),
  );
  const suggestions = (discoveredQuery.data ?? [])
    .filter((host) => host.source === "ssh-config" && !savedDestinations.has(host.alias))
    .map((host) => host.alias);

  const connect = (host: DesktopSshHost) =>
    void connectRemoteHost(host.id).catch((error: unknown) => reportConnectFailure(host, error));

  const save = async (input: DesktopSshHostInput) => {
    const host = await saveRemoteHost(input);
    if (input.id === undefined) connect(host);
  };

  const remove = async (host: DesktopSshHost) => {
    const confirmed = await readLocalNativeApi()?.dialogs.confirm(
      `Remove ${host.label}?\n\nIts projects and chats stay on the host and come back if you add it again.`,
    );
    if (confirmed) removeHost.mutate(host.id);
  };

  return (
    <div className="space-y-6">
      <SettingsSectionShell
        title="Hosts"
        action={
          <Button size="xs" variant="outline" onClick={() => setDialog({ host: null })}>
            <PlusIcon aria-hidden />
            Add host
          </Button>
        }
      >
        <SettingsCard>
          {environments.length === 0 ? (
            <SettingsEmptyState layout="status">
              Run chats on another machine. Add a host and its projects appear in the sidebar.
            </SettingsEmptyState>
          ) : (
            environments.map((environment) => (
              <SshHostRow
                key={environment.key}
                environment={environment}
                removing={removeHost.isPending && removeHost.variables === environment.host.id}
                onReconnect={() =>
                  void repairRemoteHost(environment.host.id).catch((error: unknown) =>
                    reportConnectFailure(environment.host, error),
                  )
                }
                onEdit={() => setDialog({ host: environment.host })}
                onRemove={() => void remove(environment.host)}
              />
            ))
          )}
        </SettingsCard>
      </SettingsSectionShell>

      {suggestions.length > 0 ? (
        <SettingsSectionShell title="From your SSH config">
          <SettingsCard>
            {suggestions.map((alias) => (
              <SettingsListRow
                key={alias}
                title={<span className="font-mono">{alias}</span>}
                actions={
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() =>
                      void save({
                        label: alias,
                        destination: alias,
                        port: null,
                        identityFile: null,
                      })
                    }
                  >
                    Add
                  </Button>
                }
              />
            ))}
          </SettingsCard>
        </SettingsSectionShell>
      ) : null}

      <SshHostDialog
        open={dialog !== null}
        host={dialog?.host ?? null}
        suggestions={suggestions}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        onSave={async (input) => {
          try {
            await save(input);
          } catch (error) {
            throw new Error(ipcErrorMessage(error, "Could not save the host."), { cause: error });
          }
        }}
      />
    </div>
  );
}

function SshHostRow(props: {
  readonly environment: RemoteEnvironment;
  readonly removing: boolean;
  readonly onReconnect: () => void;
  readonly onEdit: () => void;
  readonly onRemove: () => void;
}) {
  const { host } = props.environment;
  const availability = remoteHostAvailability(props.environment);
  return (
    <SettingsListRow
      title={
        <span className="flex min-w-0 items-baseline gap-2">
          {availability.needsUser ? (
            <HostStatusDot tone="attention" className="self-center" />
          ) : null}
          <span className="truncate">{host.label}</span>
          {host.label === hostAddress(host) ? null : (
            <span className="truncate font-mono text-ui-xs font-normal text-muted-foreground">
              {hostAddress(host)}
            </span>
          )}
        </span>
      }
      {...(availability.needsUser
        ? { description: props.environment.connection?.detail ?? availability.reason }
        : {})}
      actions={
        <>
          <Menu>
            <MenuTrigger
              render={
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label={`More actions for ${host.label}`}
                  disabled={props.removing}
                />
              }
            >
              <EllipsisIcon aria-hidden />
            </MenuTrigger>
            <ComposerPickerMenuPopup align="end">
              <MenuItem onClick={props.onReconnect}>
                <RefreshCwIcon aria-hidden className="size-3.5 opacity-70" />
                Reconnect
              </MenuItem>
              <MenuItem onClick={props.onEdit}>
                <PencilEdit02Icon aria-hidden className="size-3.5 opacity-70" />
                Edit
              </MenuItem>
              <MenuItem variant="destructive" onClick={props.onRemove}>
                <Delete02Icon aria-hidden className="size-3.5" />
                Remove
              </MenuItem>
            </ComposerPickerMenuPopup>
          </Menu>
        </>
      }
    />
  );
}
