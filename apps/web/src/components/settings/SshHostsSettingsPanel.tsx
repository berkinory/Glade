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
import {
  CloudServerIcon,
  Delete02Icon,
  PencilEdit02Icon,
  PlusIcon,
  RefreshCwIcon,
  ServerIcon,
} from "~/lib/icons";
import { ipcErrorMessage } from "~/lib/ipcErrorMessage";
import { readLocalNativeApi } from "~/nativeApi";
import { Button } from "../ui/button";
import { MenuItem } from "../ui/menu";
import { MachineRow } from "./machine/MachineRow";
import { SettingsTile } from "./SettingsTile";
import { toastManager } from "../ui/toast";
import { SshHostDialog } from "./SshHostDialog";
import { HostRemoteAccessDialog } from "./remoteAccess/HostRemoteAccessDialog";
import { SettingsCard, SettingsEmptyState, SettingsSectionShell } from "./SettingsPanelPrimitives";

function hostAddress(host: DesktopSshHost): string {
  return host.port === null ? host.destination : `${host.destination}:${host.port}`;
}

type SshEnvironment = Extract<RemoteEnvironment, { readonly kind: "ssh" }>;

function reportConnectFailure(host: DesktopSshHost, error: unknown): void {
  toastManager.add({
    type: "error",
    title: "Could not connect to host",
    description: `Could not connect to ${host.label}. ${ipcErrorMessage(error, "Try again.")}`,
  });
}

export function SshHostsSettingsPanel() {
  const api = window.desktopBridge?.sshHosts;
  const environments = useRemoteEnvironments().filter(
    (environment): environment is SshEnvironment => environment.kind === "ssh",
  );
  const [dialog, setDialog] = useState<{ readonly host: DesktopSshHost | null } | null>(null);
  const [remoteAccessKey, setRemoteAccessKey] = useState<string | null>(null);
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
        title="SSH hosts"
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
                onRemoteAccess={() => setRemoteAccessKey(environment.key)}
                onRemove={() => void remove(environment.host)}
              />
            ))
          )}
        </SettingsCard>
      </SettingsSectionShell>

      {suggestions.length > 0 ? (
        <SettingsSectionShell title="From your SSH config">
          <SettingsCard divided={false} className="grid grid-cols-1 gap-0.5 p-1 sm:grid-cols-2">
            {suggestions.map((alias) => (
              <button
                key={alias}
                type="button"
                onClick={() =>
                  void save({ label: alias, destination: alias, port: null, identityFile: null })
                }
                className="group flex min-w-0 items-center gap-3 rounded-lg px-2.5 py-2 text-left outline-none hover:bg-[var(--color-background-elevated-secondary)] focus-visible:ring-1 focus-visible:ring-ring/60"
              >
                <SettingsTile>
                  <ServerIcon />
                </SettingsTile>
                <span className="min-w-0 flex-1 truncate font-mono text-ui text-foreground">
                  {alias}
                </span>
                <PlusIcon
                  aria-hidden
                  className="size-4 shrink-0 text-muted-foreground group-hover:text-foreground"
                />
              </button>
            ))}
          </SettingsCard>
        </SettingsSectionShell>
      ) : null}

      <HostRemoteAccessDialog
        environment={
          environments.find(
            (environment) => environment.key === remoteAccessKey && environment.api !== null,
          ) ?? null
        }
        onOpenChange={(open) => {
          if (!open) setRemoteAccessKey(null);
        }}
      />

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
  readonly environment: SshEnvironment;
  readonly removing: boolean;
  readonly onReconnect: () => void;
  readonly onEdit: () => void;
  readonly onRemoteAccess: () => void;
  readonly onRemove: () => void;
}) {
  const availability = remoteHostAvailability(props.environment);
  return (
    <MachineRow
      environment={props.environment}
      address={hostAddress(props.environment.host)}
      busy={props.removing}
      action={
        availability.needsUser ? (
          <Button size="sm" variant="outline" onClick={props.onReconnect}>
            Reconnect
          </Button>
        ) : null
      }
      menuItems={
        <>
          <MenuItem onClick={props.onReconnect}>
            <RefreshCwIcon aria-hidden className="size-3.5 opacity-70" />
            Reconnect
          </MenuItem>
          <MenuItem onClick={props.onEdit}>
            <PencilEdit02Icon aria-hidden className="size-3.5 opacity-70" />
            Edit
          </MenuItem>
          <MenuItem
            disabled={!availability.selectable}
            title={availability.selectable ? undefined : availability.reason}
            onClick={props.onRemoteAccess}
          >
            <CloudServerIcon aria-hidden className="size-3.5 opacity-70" />
            Remote access
          </MenuItem>
          <MenuItem variant="destructive" onClick={props.onRemove}>
            <Delete02Icon aria-hidden className="size-3.5" />
            Remove
          </MenuItem>
        </>
      }
    />
  );
}
