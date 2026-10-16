import type { ServerProviderStatus } from "@glade/contracts/server/server";
import { useQueries, useQuery } from "@tanstack/react-query";

import { useAppSettings } from "../../appSettings";
import { LOCAL_ENVIRONMENT, type EnvironmentKey } from "../../environments/environmentKey";
import { useRemoteEnvironments } from "../../environments/remoteEnvironments";
import { isRemoteClient } from "../../lib/remoteClient";
import {
  environmentServerConfigQueryOptions,
  serverSettingsQueryOptions,
} from "../../lib/serverReactQuery";
import { isProviderUpdateActive, shouldShowProviderUpdateStatus } from "../../providerUpdates";

export interface ProviderUpdateItem {
  readonly id: string;
  readonly environmentKey: EnvironmentKey;
  // null is this computer.
  readonly machineLabel: string | null;
  readonly provider: ServerProviderStatus;
  // False when the CLI updates itself outside Glade; the dialog offers its command instead.
  readonly oneClick: boolean;
  readonly active: boolean;
}

// Every provider behind its latest release, across this computer and every reachable SSH host.
export function usePendingProviderUpdates(): ReadonlyArray<ProviderUpdateItem> {
  const { settings } = useAppSettings();
  const serverSettings = useQuery(serverSettingsQueryOptions()).data;
  const remoteEnvironments = useRemoteEnvironments();
  // Provider CLIs belong to whoever sits at the machine; a paired client leaves them alone.
  const machines = isRemoteClient
    ? []
    : [
        { key: LOCAL_ENVIRONMENT, label: null },
        ...remoteEnvironments
          .filter((environment) => environment.api !== null && !environment.incompatible)
          .map((environment) => ({ key: environment.key, label: environment.host.label })),
      ];
  const configs = useQueries({
    queries: machines.map((machine) => environmentServerConfigQueryOptions(machine.key)),
  });
  const providerSettings = serverSettings
    ? { ...serverSettings, enableProviderUpdateChecks: settings.enableProviderUpdateChecks }
    : null;

  return machines.flatMap((machine, index) =>
    (configs[index]?.data?.providers ?? [])
      .filter((provider) =>
        shouldShowProviderUpdateStatus({ provider, serverSettings: providerSettings }),
      )
      .map((provider) => ({
        id: `${machine.key}:${provider.provider}`,
        environmentKey: machine.key,
        machineLabel: machine.label,
        provider,
        oneClick: shouldShowProviderUpdateStatus({
          provider,
          serverSettings: providerSettings,
          oneClickOnly: true,
        }),
        active: isProviderUpdateActive(provider),
      })),
  );
}

export interface MachineUpdates {
  readonly environmentKey: EnvironmentKey;
  readonly machineLabel: string | null;
  readonly items: ReadonlyArray<ProviderUpdateItem>;
}

export function groupByMachine(items: ReadonlyArray<ProviderUpdateItem>): MachineUpdates[] {
  const groups = new Map<EnvironmentKey, MachineUpdates>();
  for (const item of items) {
    const group = groups.get(item.environmentKey);
    groups.set(item.environmentKey, {
      environmentKey: item.environmentKey,
      machineLabel: item.machineLabel,
      items: [...(group?.items ?? []), item],
    });
  }
  return [...groups.values()];
}
