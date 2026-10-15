import { PROVIDER_DISPLAY_NAMES } from "@glade/contracts/provider/model";
import type { ServerProviderStatus } from "@glade/contracts/server/server";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { useAppSettings } from "../appSettings";
import { LOCAL_ENVIRONMENT, type EnvironmentKey } from "../environments/environmentKey";
import { useRemoteEnvironments } from "../environments/remoteEnvironments";
import { isRemoteClient } from "../lib/remoteClient";
import {
  environmentServerConfigQueryOptions,
  serverSettingsQueryOptions,
} from "../lib/serverReactQuery";
import { ensureEnvironmentNativeApi } from "../nativeApi";
import {
  isProviderUpdateActive,
  shouldShowProviderUpdateStatus,
  updateProviders,
} from "../providerUpdates";
import { toastManager } from "./ui/toast";
import { useDesktopUpdate, type DesktopUpdateControls } from "./useDesktopUpdate";

// Installing the app update restarts Glade; every SSH host then receives the matching server when
// it reconnects, so the app update also covers the hosts.
interface DesktopUpdateControl {
  readonly installReady: boolean;
  readonly version: string | null;
  readonly install: () => void;
}

interface HostProviderUpdates {
  readonly environmentKey: EnvironmentKey;
  readonly hostLabel: string | null;
  readonly providers: ReadonlyArray<ServerProviderStatus>;
}

interface HostProviderFailure {
  readonly hostLabel: string | null;
  readonly provider: ServerProviderStatus;
  readonly reason: string;
}

const listFormat = new Intl.ListFormat("en", { type: "conjunction" });

function onHost(hostLabel: string | null): string {
  return hostLabel ? ` on ${hostLabel}` : "";
}

function describeUpdates(hosts: ReadonlyArray<HostProviderUpdates>, desktop: DesktopUpdateControl) {
  const parts = hosts.map(
    (host) =>
      `${listFormat.format(host.providers.map((p) => PROVIDER_DISPLAY_NAMES[p.provider]))} on ${host.hostLabel ?? "this computer"}`,
  );
  if (desktop.installReady) parts.unshift(`Glade ${desktop.version ?? ""}`.trim());
  return `Updates ${parts.join(", ")}.${desktop.installReady ? " Glade restarts when done." : ""}`;
}

async function updateHostProviders(
  hosts: ReadonlyArray<HostProviderUpdates>,
): Promise<HostProviderFailure[]> {
  const results = await Promise.all(
    hosts.map(async (host) => {
      try {
        const api = ensureEnvironmentNativeApi(host.environmentKey);
        const failures = await updateProviders(api, host.providers);
        return failures.map((failure) => ({ ...failure, hostLabel: host.hostLabel }));
      } catch (error) {
        const reason = error instanceof Error ? error.message : "The update request failed.";
        return host.providers.map((provider) => ({ provider, reason, hostLabel: host.hostLabel }));
      }
    }),
  );
  return results.flat();
}

export interface UpdateControls {
  desktopUpdate: DesktopUpdateControls;
  updateButton: {
    label: string;
    secondaryLabel: string | null;
    downloadPercent: number | null;
    tooltip: string;
    disabled: boolean;
    onClick: () => void;
  };
  showUpdateButton: boolean;
}

export function useUpdateEverything(): UpdateControls {
  const desktopUpdate = useDesktopUpdate();
  const desktop: DesktopUpdateControl = {
    installReady:
      desktopUpdate.showDesktopUpdateButton &&
      desktopUpdate.desktopUpdateButtonAction === "install" &&
      !desktopUpdate.desktopUpdateButtonDisabled,
    version: desktopUpdate.desktopUpdateReadyVersion,
    install: desktopUpdate.handleDesktopUpdateButtonClick,
  };
  const queryClient = useQueryClient();
  const { settings } = useAppSettings();
  const serverSettings = useQuery(serverSettingsQueryOptions()).data;
  const remoteEnvironments = useRemoteEnvironments();
  const [updating, setUpdating] = useState(false);
  // Provider CLIs belong to whoever sits at the machine; a paired client leaves them alone.
  const environments = isRemoteClient
    ? []
    : [
        { key: LOCAL_ENVIRONMENT, hostLabel: null },
        ...remoteEnvironments
          .filter((environment) => environment.api !== null && !environment.incompatible)
          .map((environment) => ({ key: environment.key, hostLabel: environment.host.label })),
      ];
  const configs = useQueries({
    queries: environments.map((environment) =>
      environmentServerConfigQueryOptions(environment.key),
    ),
  });
  const providerSettings = serverSettings
    ? { ...serverSettings, enableProviderUpdateChecks: settings.enableProviderUpdateChecks }
    : null;
  const hosts: HostProviderUpdates[] = environments.flatMap((environment, index) => {
    const providers = (configs[index]?.data?.providers ?? []).filter(
      (provider) =>
        !isProviderUpdateActive(provider) &&
        shouldShowProviderUpdateStatus({
          provider,
          serverSettings: providerSettings,
          oneClickOnly: true,
        }),
    );
    return providers.length > 0
      ? [{ environmentKey: environment.key, hostLabel: environment.hostLabel, providers }]
      : [];
  });
  const providerCount = hosts.reduce((count, host) => count + host.providers.length, 0);

  const updateAll = async () => {
    const restartAfter = desktop.installReady;
    setUpdating(true);
    const failures = await updateHostProviders(hosts);
    await Promise.all(
      hosts.map((host) =>
        queryClient
          .invalidateQueries({
            queryKey: environmentServerConfigQueryOptions(host.environmentKey).queryKey,
          })
          .catch(() => undefined),
      ),
    );
    setUpdating(false);

    if (failures.length > 0) {
      const manualCommands = [
        ...new Set(
          failures.flatMap(({ provider }) => provider.versionAdvisory?.updateCommand?.trim() || []),
        ),
      ];
      toastManager.add({
        type: "error",
        title:
          failures.length === providerCount
            ? "Provider updates failed"
            : "Some provider updates failed",
        description: failures
          .map(
            ({ provider, reason, hostLabel }) =>
              `${PROVIDER_DISPLAY_NAMES[provider.provider]}${onHost(hostLabel)}: ${reason}`,
          )
          .join("\n"),
        timeout: 0,
        ...(manualCommands.length > 0 ? { data: { copyText: manualCommands.join("\n") } } : {}),
        ...(restartAfter
          ? { actionProps: { children: "Restart anyway", onClick: desktop.install } }
          : {}),
      });
      return;
    }
    if (restartAfter) {
      desktop.install();
      return;
    }
    toastManager.add({
      type: "success",
      title: providerCount === 1 ? "Provider updated" : `${providerCount} providers updated`,
      description: "New sessions will use the refreshed provider tools.",
      timeout: 6000,
    });
  };

  const onClick = () => {
    if (updating) return;
    void updateAll();
  };

  const pending = providerCount + (desktop.installReady ? 1 : 0);
  const showEverything =
    !desktopUpdate.installing && (updating || providerCount > 0 || desktop.installReady);
  return {
    desktopUpdate,
    showUpdateButton: showEverything || desktopUpdate.showDesktopUpdateButton,
    updateButton: showEverything
      ? {
          label: updating ? "Updating..." : pending > 1 ? "Update all" : "Update",
          secondaryLabel: null,
          downloadPercent: null,
          tooltip: updating ? "Updating providers..." : describeUpdates(hosts, desktop),
          disabled: updating,
          onClick,
        }
      : {
          ...desktopUpdate.desktopUpdateButtonPresentation,
          downloadPercent: desktopUpdate.desktopUpdateDownloadPercent,
          tooltip: desktopUpdate.desktopUpdateTooltip,
          disabled:
            desktopUpdate.desktopUpdateButtonDisabled ||
            desktopUpdate.desktopUpdateButtonAction === "none",
          onClick: desktopUpdate.handleDesktopUpdateButtonClick,
        },
  };
}
