import type { ProviderKind } from "@glade/contracts/core/baseSchemas";
import { PROVIDER_DISPLAY_NAMES } from "@glade/contracts/provider/model";
import type { ServerProviderStatus } from "@glade/contracts/server/server";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { ProviderIcon } from "~/components/ProviderIcon";
import { connectRemoteEnvironment } from "~/environments/remoteEnvironments";
import { RefreshCwIcon } from "~/lib/icons";
import { environmentServerConfigQueryOptions } from "~/lib/serverReactQuery";
import { DEFAULT_PROVIDER_ORDER } from "~/providerOrdering";
import { Button } from "../../ui/button";
import { IconButton } from "../../ui/icon-button";
import { Skeleton } from "../../ui/skeleton";
import { Spinner } from "../../ui/spinner";
import { toastManager } from "../../ui/toast";
import { ProviderSignIn } from "../ProviderSignIn";
import { providerSetupStatus } from "../providerSetupStatus";
import { SettingsCard, SettingsEmptyState, SettingsSectionShell } from "../SettingsPanelPrimitives";
import { SettingsStatus } from "../SettingsStatus";
import { SettingsTile } from "../SettingsTile";
import type { SettingsMachine } from "./settingsMachine";

function updateAvailable(status: ServerProviderStatus | undefined): boolean {
  return (
    status?.versionAdvisory?.status === "behind_latest" && status.versionAdvisory.canUpdate === true
  );
}

function ProviderRow(props: {
  readonly provider: ProviderKind;
  readonly status: ServerProviderStatus | undefined;
  readonly machine: SettingsMachine;
  readonly updating: boolean;
  readonly onUpdate: () => void;
}) {
  const { provider, status, machine } = props;
  const setup = providerSetupStatus({ status, reconciled: status !== undefined, disabled: false });
  const version = status?.version ?? null;
  return (
    <div>
      <div className="flex min-w-0 items-center gap-3 px-3 py-2.5">
        <SettingsTile>
          <ProviderIcon provider={provider} className="size-4" />
        </SettingsTile>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-ui font-medium text-foreground">
            {PROVIDER_DISPLAY_NAMES[provider]}
          </span>
          <span className="flex min-w-0 items-center gap-2 text-ui-sm text-muted-foreground">
            <SettingsStatus tone={setup.tone} label={setup.label} />
            {version ? <span className="truncate">· {version}</span> : null}
          </span>
        </span>
        {updateAvailable(status) ? (
          <Button size="sm" variant="outline" disabled={props.updating} onClick={props.onUpdate}>
            {props.updating ? <Spinner className="size-4" /> : null}
            Update to {status?.versionAdvisory?.latestVersion}
          </Button>
        ) : null}
      </div>
      {status?.available === true ? (
        <ProviderSignIn
          provider={provider}
          authenticated={status.authStatus !== "unauthenticated"}
          environment={machine.key}
        />
      ) : null}
    </div>
  );
}

// The agent CLIs on an SSH host or paired machine: what is installed and signed in there, with the
// host's own sign-in and updates. Which agents Glade offers is set once, under Local.
export function HostProvidersPanel(props: { readonly machine: SettingsMachine }) {
  const { machine } = props;
  const queryClient = useQueryClient();
  const configQuery = useQuery({
    ...environmentServerConfigQueryOptions(machine.key),
    enabled: machine.api !== null,
  });
  const [refreshing, setRefreshing] = useState(false);
  const [updating, setUpdating] = useState<ReadonlySet<ProviderKind>>(new Set());
  const statuses = new Map(
    (configQuery.data?.providers ?? []).map((status) => [status.provider, status]),
  );
  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: environmentServerConfigQueryOptions(machine.key).queryKey,
    });

  const refresh = () => {
    if (!machine.api) return;
    setRefreshing(true);
    void machine.api.server
      .refreshProviders()
      .then(invalidate)
      .catch((error: unknown) =>
        toastManager.add({
          type: "error",
          title: "Could not check agents",
          description: `Could not check the agents on ${machine.label}. ${error instanceof Error ? error.message : "Try again."}`,
        }),
      )
      .finally(() => setRefreshing(false));
  };

  const update = (provider: ProviderKind) => {
    if (!machine.api) return;
    setUpdating((current) => new Set(current).add(provider));
    void machine.api.server
      .updateProvider({ provider })
      .then(invalidate)
      .catch((error: unknown) =>
        toastManager.add({
          type: "error",
          title: "Could not update provider",
          description: `Could not update ${PROVIDER_DISPLAY_NAMES[provider]} on ${machine.label}. ${error instanceof Error ? error.message : "Try again."}`,
        }),
      )
      .finally(() =>
        setUpdating((current) => {
          const next = new Set(current);
          next.delete(provider);
          return next;
        }),
      );
  };

  if (!machine.remote) return null;
  const remote = machine.remote;

  return (
    <SettingsSectionShell
      title={`Agents on ${machine.label}`}
      action={
        <IconButton
          variant="ghost"
          size="icon-xs"
          label="Check again"
          disabled={machine.api === null || refreshing}
          onClick={refresh}
        >
          <RefreshCwIcon className={refreshing ? "animate-spin" : undefined} />
        </IconButton>
      }
    >
      {machine.api === null ? (
        <SettingsEmptyState layout="status">
          <span className="flex flex-wrap items-center justify-between gap-3">
            {machine.label} is not connected. Glade keeps trying in the background.
            <Button
              size="sm"
              variant="outline"
              onClick={() => void connectRemoteEnvironment(remote).catch(() => undefined)}
            >
              Reconnect
            </Button>
          </span>
        </SettingsEmptyState>
      ) : !configQuery.data ? (
        <SettingsCard>
          {DEFAULT_PROVIDER_ORDER.map((provider) => (
            <div key={provider} className="flex items-center gap-3 px-3 py-2.5">
              <Skeleton className="size-8 rounded-lg" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-24" />
                <Skeleton className="h-3 w-36" />
              </div>
            </div>
          ))}
        </SettingsCard>
      ) : (
        <SettingsCard>
          {DEFAULT_PROVIDER_ORDER.map((provider) => (
            <ProviderRow
              key={provider}
              provider={provider}
              status={statuses.get(provider)}
              machine={machine}
              updating={updating.has(provider)}
              onUpdate={() => update(provider)}
            />
          ))}
        </SettingsCard>
      )}
      <p className="px-2 text-ui-xs text-muted-foreground">
        Chats on {machine.label} use the agent CLIs installed there. Which agents Glade offers, and
        their order, are set under Local.
      </p>
    </SettingsSectionShell>
  );
}
