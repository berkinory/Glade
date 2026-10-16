import { PROVIDER_DISPLAY_NAMES } from "@glade/contracts/provider/model";
import { type ServerProviderStatus } from "@glade/contracts/server/server";
import { QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { NativeApi } from "@glade/contracts/ipc/ipc";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAppSettings } from "../appSettings";
import { DownloadIcon, SettingsIcon } from "~/lib/icons";
import { toastManager } from "../components/ui/toast";
import { useActiveEnvironment } from "../environments/activeEnvironment";
import { LOCAL_ENVIRONMENT, type EnvironmentKey } from "../environments/environmentKey";
import {
  PROVIDER_AUTH_REFRESH_MIN_INTERVAL_MS,
  useProviderAuthRefreshOnFocus,
} from "../hooks/useProviderAuthRefreshOnFocus";
import { useProviderStatusRefresh } from "../hooks/useProviderStatusRefresh";
import {
  environmentServerConfigQueryOptions,
  serverConfigQueryOptions,
  serverSettingsQueryOptions,
} from "../lib/serverReactQuery";
import { ensureEnvironmentNativeApi } from "../nativeApi";
import {
  PROVIDER_UPDATE_INITIAL_REFRESH_DELAY_MS,
  PROVIDER_UPDATE_REFRESH_INTERVAL_MS,
  getNotifiableProviderUpdateStatuses,
  isProviderUpdateActive,
  providerUpdateNotificationKey,
  updateProviders,
  type ProviderUpdateFailure,
} from "../providerUpdates";
import { prefetchModelsForNewThread } from "../lib/providerModelPrefetch";
import { isRemoteClient } from "../lib/remoteClient";
import { SETTINGS_TARGETS } from "../settingsNavigation";
import { addWsTransportStateListener } from "../wsTransportEvents";

const seenProviderUpdateNotificationKeys = new Set<string>();
type ProviderUpdateToastId = ReturnType<typeof toastManager.add>;
type ActiveProviderUpdateToast =
  | {
      readonly kind: "prompt";
      readonly key: string;
      readonly toastId: ProviderUpdateToastId;
    }
  | {
      readonly kind: "update";
      readonly key: string;
      readonly toastId: ProviderUpdateToastId;
    };
export function ProviderStatusRefreshCoordinator() {
  const { settings } = useAppSettings();
  const queryClient = useQueryClient();
  const serverConfigQuery = useQuery(serverConfigQueryOptions());
  const serverSettingsQuery = useQuery(serverSettingsQueryOptions());
  const [transportOpen, setTransportOpen] = useState(false);
  const [liveVersionCheckCompleted, setLiveVersionCheckCompleted] = useState(false);
  const providerUpdateChecksEnabled =
    serverSettingsQuery.data !== undefined && settings.enableProviderUpdateChecks;
  const providerUpdateRefreshEnabled = providerUpdateChecksEnabled && transportOpen;
  const markLiveVersionCheckCompleted = useCallback(() => {
    setLiveVersionCheckCompleted(true);
  }, []);

  // The update coordinator includes the same focus/visibility refresh. Keep the auth-only loop for
  // the setting-off case so enabling update checks never launches duplicate provider probes on focus.
  useProviderAuthRefreshOnFocus({ enabled: !providerUpdateChecksEnabled });
  useEffect(
    () =>
      addWsTransportStateListener(
        (state) => {
          const open = state === "open";
          setTransportOpen(open);
          if (!open) {
            setLiveVersionCheckCompleted(false);
          }
        },
        { replayCurrent: true },
      ),
    [],
  );

  useEffect(() => {
    if (!transportOpen || !serverSettingsQuery.data || !serverConfigQuery.data) return;
    prefetchModelsForNewThread(queryClient, {
      settings,
      serverSettings: serverSettingsQuery.data,
      providerStatuses: serverConfigQuery.data.providers,
      statusesReconciled: true,
      providerOrder: settings.providerOrder,
    });
  }, [queryClient, settings, serverSettingsQuery.data, serverConfigQuery.data, transportOpen]);

  useEffect(() => {
    if (!providerUpdateChecksEnabled) {
      setLiveVersionCheckCompleted(false);
    }
  }, [providerUpdateChecksEnabled]);

  useProviderStatusRefresh({
    enabled: providerUpdateRefreshEnabled,
    initialDelayMs: PROVIDER_UPDATE_INITIAL_REFRESH_DELAY_MS,
    intervalMs: PROVIDER_UPDATE_REFRESH_INTERVAL_MS,
    minIntervalMs: PROVIDER_AUTH_REFRESH_MIN_INTERVAL_MS,
    refreshOnFocus: true,
    onRefreshSuccess: markLiveVersionCheckCompleted,
  });

  return (
    <ProviderUpdateNotifications
      environmentKey={LOCAL_ENVIRONMENT}
      hostLabel={null}
      // Updating provider CLIs is a decision for whoever sits at this machine; a paired phone
      // finds pending updates in Settings → Providers instead of a prompt.
      visible={!isRemoteClient}
      liveVersionCheckCompleted={providerUpdateRefreshEnabled && liveVersionCheckCompleted}
    />
  );
}

// A host's server checks its own provider CLIs: once per connection, so its chats know which
// providers it has, and hourly for updates. Its update prompt shows only in that host's chats.
export function HostProviderUpdates(props: {
  readonly environmentKey: EnvironmentKey;
  readonly hostLabel: string;
  readonly api: NativeApi;
}) {
  const { settings } = useAppSettings();
  const queryClient = useQueryClient();
  const activeEnvironment = useActiveEnvironment();
  const [checked, setChecked] = useState(false);
  const { api, environmentKey } = props;
  const updateChecks = settings.enableProviderUpdateChecks;

  useEffect(() => {
    let cancelled = false;
    const refresh = () =>
      void api.server
        .refreshProviders()
        .then(() => {
          if (cancelled) return;
          setChecked(true);
          void queryClient.invalidateQueries({
            queryKey: environmentServerConfigQueryOptions(environmentKey).queryKey,
          });
        })
        .catch(() => undefined);
    refresh();
    const interval = updateChecks
      ? window.setInterval(refresh, PROVIDER_UPDATE_REFRESH_INTERVAL_MS)
      : null;
    return () => {
      cancelled = true;
      if (interval !== null) window.clearInterval(interval);
    };
  }, [api, environmentKey, queryClient, updateChecks]);

  return (
    <ProviderUpdateNotifications
      environmentKey={environmentKey}
      hostLabel={props.hostLabel}
      visible={activeEnvironment === environmentKey}
      liveVersionCheckCompleted={checked && updateChecks}
    />
  );
}
async function runProviderUpdateAll(params: {
  environmentKey: EnvironmentKey;
  hostLabel: string | null;
  providers: ReadonlyArray<ServerProviderStatus>;
  queryClient: QueryClient;
  activeToastRef: { current: ActiveProviderUpdateToast | null };
  isUpdatingAllRef: { current: boolean };
  progressToastDismissedRef: { current: boolean };
  setIsUpdatingAll: (value: boolean) => void;
}): Promise<void> {
  const {
    environmentKey,
    hostLabel,
    providers,
    queryClient,
    activeToastRef,
    isUpdatingAllRef,
    progressToastDismissedRef,
    setIsUpdatingAll,
  } = params;
  const activeNotificationKey = providerUpdateNotificationKey(providers);
  const onMachine = hostLabel ? ` on ${hostLabel}` : "";
  if (isUpdatingAllRef.current || providers.length === 0 || !activeNotificationKey) {
    return;
  }

  isUpdatingAllRef.current = true;
  progressToastDismissedRef.current = false;
  setIsUpdatingAll(true);
  const updatingDescription =
    providers.length === 1
      ? `Updating ${PROVIDER_DISPLAY_NAMES[providers[0]!.provider]}${onMachine}.`
      : `Updating ${providers.length} providers${onMachine}.`;
  const trackedToast = activeToastRef.current;
  const toastId =
    trackedToast?.toastId ??
    toastManager.add({
      type: "loading",
      title: "Updating providers…",
      description: updatingDescription,
      timeout: 0,
    });
  activeToastRef.current = { kind: "update", key: activeNotificationKey, toastId };
  const dismissProgressToast = () => {
    progressToastDismissedRef.current = true;
    if (activeToastRef.current?.toastId === toastId) {
      activeToastRef.current = null;
    }
    toastManager.close(toastId);
  };

  toastManager.update(toastId, {
    type: "loading",
    title: "Updating providers…",
    description: updatingDescription,
    data: { onClose: dismissProgressToast },
    timeout: 0,
  });

  const failures: ProviderUpdateFailure[] = [];

  try {
    failures.push(
      ...(await updateProviders(ensureEnvironmentNativeApi(environmentKey), providers)),
    );
  } catch (error) {
    for (const provider of providers) {
      failures.push({
        provider,
        reason:
          error instanceof Error ? error.message : "The provider update request could not start.",
      });
    }
  } finally {
    // Refresh is best-effort UI sync; it must not keep the progress toast alive.
    await queryClient
      .invalidateQueries({ queryKey: environmentServerConfigQueryOptions(environmentKey).queryKey })
      .catch(() => undefined);
    isUpdatingAllRef.current = false;
    setIsUpdatingAll(false);
  }

  if (progressToastDismissedRef.current || activeToastRef.current?.toastId !== toastId) {
    return;
  }

  if (failures.length > 0) {
    activeToastRef.current = null;

    const manualCommands = Array.from(
      new Set(
        failures
          .map(({ provider }) => provider.versionAdvisory?.updateCommand)
          .filter(
            (command): command is string =>
              typeof command === "string" && command.trim().length > 0,
          ),
      ),
    );
    const failureLines = failures
      .map(({ provider, reason }) => `${PROVIDER_DISPLAY_NAMES[provider.provider]}: ${reason}`)
      .join("\n");
    const failureHeading = hostLabel ? `Provider updates failed${onMachine}.\n` : "";
    toastManager.update(toastId, {
      type: "error",
      title:
        failures.length === providers.length
          ? "Could not update providers"
          : "Could not update some providers",
      description:
        manualCommands.length > 0
          ? `${failureHeading}${failureLines}\n\nCopy the command${manualCommands.length === 1 ? "" : "s"} below to update manually in a terminal.`
          : `${failureHeading}${failureLines}`,
      data: {
        onClose: dismissProgressToast,
        ...(manualCommands.length > 0 ? { copyText: manualCommands.join("\n") } : {}),
      },
      timeout: 0,
    });
    return;
  }

  activeToastRef.current = null;
  toastManager.update(toastId, {
    type: "success",
    title: providers.length === 1 ? "Provider updated" : "Providers updated",
    description: `${
      providers.length === 1
        ? `${PROVIDER_DISPLAY_NAMES[providers[0]!.provider]} was updated${onMachine}.`
        : `${providers.length} providers were updated${onMachine}.`
    } New sessions will use the refreshed provider tools.`,
    data: { onClose: dismissProgressToast },
    timeout: 6000,
  });
}
function ProviderUpdateNotifications({
  environmentKey,
  hostLabel,
  visible,
  liveVersionCheckCompleted,
}: {
  readonly environmentKey: EnvironmentKey;
  readonly hostLabel: string | null;
  // Shown only while the user works on this machine; a hidden prompt waits until they do.
  readonly visible: boolean;
  readonly liveVersionCheckCompleted: boolean;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { settings } = useAppSettings();
  const serverConfigQuery = useQuery(environmentServerConfigQueryOptions(environmentKey));
  const serverSettingsQuery = useQuery(serverSettingsQueryOptions());
  const providerUpdateServerSettings = serverSettingsQuery.data
    ? {
        ...serverSettingsQuery.data,
        enableProviderUpdateChecks: settings.enableProviderUpdateChecks,
      }
    : null;
  const [isUpdatingAll, setIsUpdatingAll] = useState(false);
  const activeToastRef = useRef<ActiveProviderUpdateToast | null>(null);
  const isUpdatingAllRef = useRef(false);
  const progressToastDismissedRef = useRef(false);
  const outdatedProviders = getNotifiableProviderUpdateStatuses({
    providers: serverConfigQuery.data?.providers ?? [],
    serverSettings: providerUpdateServerSettings,
    liveVersionCheckCompleted,
  });
  const oneClickProviders = outdatedProviders.filter(
    (provider) => !isProviderUpdateActive(provider),
  );
  const providersKey = providerUpdateNotificationKey(outdatedProviders);
  const notificationKey = providersKey ? `${environmentKey}|${providersKey}` : null;

  const updateAll = useCallback(
    (providers: ReadonlyArray<ServerProviderStatus>) =>
      runProviderUpdateAll({
        environmentKey,
        hostLabel,
        providers,
        queryClient,
        activeToastRef,
        isUpdatingAllRef,
        progressToastDismissedRef,
        setIsUpdatingAll,
      }),
    [environmentKey, hostLabel, queryClient],
  );

  useEffect(() => {
    const activeToast = activeToastRef.current;
    if (activeToast?.kind === "prompt" && activeToast.key !== notificationKey) {
      toastManager.close(activeToast.toastId);
      activeToastRef.current = null;
    }

    if (
      !visible ||
      outdatedProviders.length === 0 ||
      oneClickProviders.length === 0 ||
      !notificationKey ||
      isUpdatingAll ||
      activeToastRef.current ||
      seenProviderUpdateNotificationKeys.has(notificationKey)
    ) {
      return;
    }

    seenProviderUpdateNotificationKeys.add(notificationKey);

    const firstProvider = outdatedProviders[0]!;
    const additionalCount = outdatedProviders.length - 1;
    const providerName = PROVIDER_DISPLAY_NAMES[firstProvider.provider];
    const onMachine = hostLabel ? ` on ${hostLabel}` : "";
    const title =
      outdatedProviders.length === 1 ? "Provider update available" : "Provider updates available";
    const description =
      outdatedProviders.length === 1
        ? `${providerName} has a newer version available${onMachine}.`
        : `${providerName} and ${additionalCount} more provider${additionalCount === 1 ? "" : "s"} have newer versions available${onMachine}.`;

    let toastId!: ProviderUpdateToastId;
    const closeTrackedPrompt = () => {
      if (activeToastRef.current?.toastId === toastId) {
        activeToastRef.current = null;
      }
      toastManager.close(toastId);
    };
    toastId = toastManager.add({
      type: "warning",
      title,
      description,
      timeout: 0,
      ...(hostLabel
        ? {
            // Settings lists this machine's providers only, so a host's prompt updates in place.
            data: {
              onClose: closeTrackedPrompt,
              actions: [
                {
                  label: "Update",
                  icon: DownloadIcon,
                  onClick: () => void updateAll(oneClickProviders),
                },
              ],
            },
          }
        : {
            data: {
              onClose: closeTrackedPrompt,
              actions: [
                {
                  label: "Review updates",
                  icon: SettingsIcon,
                  onClick: () => {
                    if (activeToastRef.current?.toastId === toastId) {
                      toastManager.close(toastId);
                      activeToastRef.current = null;
                    }
                    void navigate({
                      to: "/settings",
                      search: { section: "providers", target: SETTINGS_TARGETS.providerUpdates },
                    });
                  },
                },
                {
                  label: "Update all",
                  icon: DownloadIcon,
                  onClick: () => {
                    void updateAll(oneClickProviders);
                  },
                },
              ],
            },
          }),
    });
    activeToastRef.current = { kind: "prompt", key: notificationKey, toastId };
  }, [
    hostLabel,
    isUpdatingAll,
    navigate,
    notificationKey,
    oneClickProviders,
    outdatedProviders,
    updateAll,
    visible,
  ]);

  return null;
}
