import { PROVIDER_DISPLAY_NAMES } from "@glade/contracts/provider/model";
import type { ServerProviderStatus } from "@glade/contracts/server/server";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { useAppSettings } from "../appSettings";
import { LOCAL_ENVIRONMENT, type EnvironmentKey } from "../environments/environmentKey";
import { useRemoteEnvironments } from "../environments/remoteEnvironments";
import { isRemoteClient } from "../lib/remoteClient";
import {
  listRunningChatsFromDesktopStore,
  type RunningChatQuitSummary,
} from "../lib/runningChatsQuitConfirmation";
import {
  environmentServerConfigQueryOptions,
  serverSettingsQueryOptions,
} from "../lib/serverReactQuery";
import { stopLocalRunningChats } from "../lib/stopRunningChats";
import { ensureEnvironmentNativeApi } from "../nativeApi";
import {
  isProviderUpdateActive,
  shouldShowProviderUpdateStatus,
  updateProviders,
} from "../providerUpdates";
import { useStore } from "../store";
import type { RunningChatsQuitDecision } from "./RunningChatsQuitDialog";
import { toastManager } from "./ui/toast";

// Installing the app update restarts Glade; every SSH host then receives the matching server when
// it reconnects, so the app update also covers the hosts.
export interface DesktopUpdateControl {
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

function listLocalRunningChats(): ReadonlyArray<RunningChatQuitSummary> {
  const state = useStore.getState();
  return state.threadsHydrated ? listRunningChatsFromDesktopStore(state) : [];
}

// One action for every pending update: provider CLIs on this computer and every connected host,
// then the app itself, stopping running chats first and resuming them after the restart if asked.
export function useUpdateEverything(desktop: DesktopUpdateControl) {
  const queryClient = useQueryClient();
  const { settings } = useAppSettings();
  const serverSettings = useQuery(serverSettingsQueryOptions()).data;
  const remoteEnvironments = useRemoteEnvironments();
  const [updating, setUpdating] = useState(false);
  const [runningChats, setRunningChats] = useState<ReadonlyArray<RunningChatQuitSummary> | null>(
    null,
  );

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
          hiddenProviders: settings.hiddenProviders,
          serverSettings: providerSettings,
          oneClickOnly: true,
        }),
    );
    return providers.length > 0
      ? [{ environmentKey: environment.key, hostLabel: environment.hostLabel, providers }]
      : [];
  });
  const providerCount = hosts.reduce((count, host) => count + host.providers.length, 0);

  const restart = async (resume: boolean) => {
    const chats = listLocalRunningChats();
    if (chats.length > 0) await stopLocalRunningChats(chats, resume);
    desktop.install();
  };

  const updateAll = async (resume: boolean) => {
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
          ? { actionProps: { children: "Restart anyway", onClick: () => void restart(resume) } }
          : {}),
      });
      return;
    }
    if (restartAfter) {
      await restart(resume);
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
    // Ask before the provider updates run, so the restart that follows them needs no attention.
    const chats = desktop.installReady ? listLocalRunningChats() : [];
    if (chats.length > 0) {
      setRunningChats(chats);
      return;
    }
    void updateAll(settings.resumeChatsAfterQuit);
  };

  const pending = providerCount + (desktop.installReady ? 1 : 0);
  return {
    button:
      updating || providerCount > 0 || desktop.installReady
        ? {
            label: updating ? "Updating..." : pending > 1 ? "Update all" : "Update",
            tooltip: updating ? "Updating providers..." : describeUpdates(hosts, desktop),
            disabled: updating,
            onClick,
          }
        : null,
    runningChats,
    cancelRestart: () => setRunningChats(null),
    confirmRestart: (decision: RunningChatsQuitDecision) => {
      setRunningChats(null);
      void updateAll(decision.resume);
    },
  };
}
