import { PROVIDER_DISPLAY_NAMES } from "@glade/contracts/provider/model";
import { type ProviderKind } from "@glade/contracts/core/baseSchemas";
import { type ServerProviderStatus } from "@glade/contracts/server/server";
import { type ServerSettings } from "@glade/contracts/settings/settings";
import {
  closestCenter,
  DndContext,
  PointerSensor,
  type DragEndEvent,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type MouseEvent, useCallback, useMemo, useRef, useState } from "react";

import type { AppSettings, AppSettingsBinding } from "~/appSettings";
import { useProviderStatusesForLocalConfig } from "~/hooks/useProviderStatusesForLocalConfig";
import { useRefreshProviderStatusesNow } from "~/hooks/useProviderStatusRefresh";
import { CentralIcon } from "~/lib/central-icons";
import { DownloadIcon, ExternalLinkIcon, Loader2Icon } from "~/lib/icons";
import {
  hasReconciledServerProviderStatuses,
  serverQueryKeys,
  serverSettingsQueryOptions,
} from "~/lib/serverReactQuery";
import { cn } from "~/lib/utils";
import { ensureNativeApi } from "~/nativeApi";
import { sameProviderOrder } from "~/providerOrdering";
import {
  isProviderLatestVersionKnowable,
  isProviderUpdateActive,
  shouldOfferProviderUpdateAction,
  shouldPromptProviderUpdate,
  shouldShowProviderUpdateStatus,
  withProviderUpdateTimeout,
} from "~/providerUpdates";
import { SETTINGS_TARGETS } from "~/settingsNavigation";
import {
  SETTINGS_INSET_LIST_CLASS_NAME,
  SETTINGS_INSET_RADIUS_CLASS_NAME,
  SETTINGS_OUTLINED_SURFACE_CLASS_NAME,
} from "~/settingsPanelStyles";
import { ELEVATED_HOVER_SURFACE_RAISED_TEXT_CLASS_NAME } from "~/surfaceStyles";

import { Button } from "../ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { DisclosureChevron } from "../ui/DisclosureChevron";
import { Switch } from "../ui/switch";
import { toastManager } from "../ui/toast";
import { ProviderIcon } from "../ProviderIcon";
import { DebouncedSettingTextInput } from "./DebouncedSettingTextInput";
import { SettingResetButton, useSettingsRestoreSignal } from "./SettingControls";
import { SettingsRow, SettingsSection } from "./SettingsPanelPrimitives";
import {
  type ProviderInstallField,
  type ProviderInstallSettings,
  PROVIDER_VISIBILITY_OPTIONS,
  VISIBLE_PROVIDER_INSTALL_SETTINGS,
  isProviderInstallConfigDirty,
  isProviderInstallSettingsDirty,
  createProviderInstallDisclosureState,
  createClosedProviderInstallDisclosureState,
  createProviderInstallResetPatch,
  setProviderListMembership,
  isProviderPickerProviderEnabled,
} from "./providerInstallationModel";

function providerSetupStatusLabel(input: {
  readonly status: ServerProviderStatus | undefined;
  readonly reconciled: boolean;
  readonly disabled: boolean;
}): string {
  if (input.disabled) return "Disabled · enable to check setup";
  if (!input.reconciled || !input.status) return "Checking setup";
  const status = input.status;
  if (!status.available) return "Unavailable";
  if (status.authStatus === "unauthenticated") return "Needs sign-in";
  if (status.status === "update-required") return "Update required";
  if (status.status !== "ready") return "Needs attention";
  if (status.authStatus === "unknown") return "Installed · sign-in not verified";
  return "Connected";
}

function ProviderDocsLinks({ docs }: { docs: ProviderInstallSettings["docs"] }) {
  return (
    <div className={cn(SETTINGS_OUTLINED_SURFACE_CLASS_NAME, "px-3 py-2.5")}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-ui leading-snug font-medium text-foreground">CLI docs</span>
        <div className="flex flex-wrap gap-2">
          {docs.map((doc) => (
            <Button
              key={`${doc.label}:${doc.href}`}
              variant="outline"
              size="sm"
              render={<a href={doc.href} target="_blank" rel="noreferrer" />}
            >
              <span>{doc.label}</span>
              <ExternalLinkIcon className="size-3" />
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}

function formatProviderVersion(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.startsWith("v") ? trimmed : `v${trimmed}`;
}

function providerUpdateStatusLabel(provider: ServerProviderStatus): string | null {
  const state = provider.updateState?.status;
  if (state === "queued") return "Update queued";
  if (state === "running") return "Updating";
  if (state === "succeeded") return "Updated";
  if (state === "failed") return "Update failed";
  if (state === "unchanged") return "Still outdated";
  const advisory = provider.versionAdvisory;
  if (advisory?.status === "behind_latest" && advisory.latestVersion) {
    const currentVersion = formatProviderVersion(advisory.currentVersion);
    const latestVersion = formatProviderVersion(advisory.latestVersion);
    return currentVersion ? `${currentVersion} -> ${latestVersion}` : `Latest ${latestVersion}`;
  }
  const currentVersion = formatProviderVersion(provider.version);
  return currentVersion ? `Current ${currentVersion}` : null;
}

function providerUpdateFailureMessage(provider: ServerProviderStatus | undefined): string | null {
  const state = provider?.updateState;
  if (!state || (state.status !== "failed" && state.status !== "unchanged")) return null;
  return state.output?.trim() || state.message || "The provider update did not complete.";
}

function ProviderUpdateAction(props: {
  providerStatus: ServerProviderStatus;
  active: boolean;
  disabled: boolean;
  onUpdate: (provider: ProviderKind) => void;
}) {
  const advisory = props.providerStatus.versionAdvisory;
  return (
    <Button
      type="button"
      size="xs"
      variant="outline"
      disabled={props.disabled}
      title={advisory?.updateCommand ? `Run ${advisory.updateCommand}` : undefined}
      onClick={(event: MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        props.onUpdate(props.providerStatus.provider);
      }}
    >
      {props.active ? (
        <Loader2Icon className="size-3.5 animate-spin" />
      ) : (
        <DownloadIcon className="size-3.5" />
      )}
      {props.active ? "Updating" : "Update"}
    </Button>
  );
}

function ProviderInstallFieldControl(props: {
  field: ProviderInstallField;
  settings: AppSettings;
  updateSettings: (patch: Partial<AppSettings>) => void;
}) {
  const id = `provider-install-${props.field.settingsKey}`;
  if (props.field.kind === "boolean") {
    return (
      <label
        htmlFor={id}
        className="flex items-start justify-between gap-3 rounded-md border border-border/70 bg-background/60 px-3 py-2"
      >
        <span className="min-w-0">
          <span className="block text-ui leading-snug font-medium text-foreground">
            {props.field.label}
          </span>
          <span className="mt-1 block text-ui leading-snug text-muted-foreground">
            {props.field.description}
          </span>
        </span>
        <Switch
          id={id}
          checked={props.settings[props.field.settingsKey]}
          onCheckedChange={(checked) =>
            props.updateSettings({ [props.field.settingsKey]: Boolean(checked) })
          }
        />
      </label>
    );
  }

  return (
    <label htmlFor={id} className="block">
      <span className="block text-ui leading-snug font-medium text-foreground">
        {props.field.label}
      </span>
      <DebouncedSettingTextInput
        id={id}
        size="sm"
        variant="soft"
        className="mt-1"
        value={props.settings[props.field.settingsKey]}
        onCommit={(nextValue) =>
          props.updateSettings({ [props.field.settingsKey]: nextValue } as Partial<AppSettings>)
        }
        placeholder={props.field.placeholder}
        spellCheck={false}
      />
      <span className="mt-1 block text-ui leading-snug text-muted-foreground">
        {props.field.description}
      </span>
    </label>
  );
}

function ProviderToolRow(props: {
  config: ProviderInstallSettings;
  open: boolean;
  settings: AppSettings;
  defaults: AppSettings;
  hiddenProviderSet: ReadonlySet<ProviderKind>;
  serverSettings: Pick<ServerSettings, "providers" | "enableProviderUpdateChecks"> | null;
  providerStatus: ServerProviderStatus | undefined;
  updatingProviders: ReadonlySet<ProviderKind>;
  onOpenChange: (open: boolean) => void;
  onUpdate: (provider: ProviderKind) => void;
  updateSettings: (patch: Partial<AppSettings>) => void;
  activity: {
    reconciled: boolean;
    pending: boolean;
    onEnable: (enabled: boolean) => void;
  };
}) {
  const { attributes, listeners, setActivatorNodeRef, setNodeRef, transform, transition } =
    useSortable({ id: props.config.provider });
  const enabled = !props.settings.disabledProviders.includes(props.config.provider);
  const title = PROVIDER_DISPLAY_NAMES[props.config.provider];
  const isDirty = isProviderInstallConfigDirty(props.config, props.settings, props.defaults);
  const showProviderUpdateStatus = props.providerStatus
    ? shouldShowProviderUpdateStatus({
        provider: props.providerStatus,
        hiddenProviderSet: props.hiddenProviderSet,
        serverSettings: props.serverSettings,
      })
    : false;
  const updateAdvisory = props.providerStatus?.versionAdvisory;
  const providerUpdateSuppressed =
    updateAdvisory?.status === "behind_latest" && !showProviderUpdateStatus;
  const currentProviderVersion = formatProviderVersion(props.providerStatus?.version);
  const providerUpdateLabel = props.providerStatus
    ? !props.settings.enableProviderUpdateChecks
      ? currentProviderVersion
        ? `Current ${currentProviderVersion}`
        : null
      : providerUpdateSuppressed
        ? null
        : providerUpdateStatusLabel(props.providerStatus)
    : null;
  const updateActive = Boolean(
    (props.providerStatus && isProviderUpdateActive(props.providerStatus)) ||
    props.updatingProviders.has(props.config.provider),
  );
  const showUpdateButton = props.providerStatus
    ? shouldPromptProviderUpdate(props.providerStatus) &&
      (showProviderUpdateStatus || updateAdvisory?.status === "unknown")
    : false;

  const showSelfManagedUpdate = props.providerStatus
    ? shouldOfferProviderUpdateAction(props.providerStatus) &&
      !isProviderLatestVersionKnowable(props.providerStatus)
    : false;

  return (
    <Collapsible open={props.open} onOpenChange={props.onOpenChange}>
      <div
        ref={setNodeRef}
        style={{ transform: CSS.Translate.toString(transform), transition }}
        className="border-t border-border/70 first:border-t-0"
      >
        <div className="flex items-center gap-3 px-3 pt-3">
          <button
            type="button"
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            aria-label={`Reorder ${title}`}
            className={cn(
              "inline-flex size-6 shrink-0 cursor-grab touch-none items-center justify-center",
              ELEVATED_HOVER_SURFACE_RAISED_TEXT_CLASS_NAME,
              SETTINGS_INSET_RADIUS_CLASS_NAME,
            )}
          >
            <CentralIcon name="dot-grid-2x3" className="size-4" />
          </button>
          <ProviderIcon provider={props.config.provider} className="size-4 shrink-0" />
          <span className="flex-1 text-ui-lg font-medium">{title}</span>
          <label className="flex items-center gap-2 text-ui-sm">
            Enabled
            <Switch
              checked={enabled}
              disabled={props.activity.pending}
              onCheckedChange={props.activity.onEnable}
              aria-label={`Enable ${title}`}
            />
          </label>
          <label className="flex items-center gap-2 text-ui-sm">
            Show in picker
            <Switch
              checked={isProviderPickerProviderEnabled(
                props.providerStatus,
                props.hiddenProviderSet.has(props.config.provider),
              )}
              disabled={!props.activity.reconciled || !props.providerStatus?.available}
              onCheckedChange={(checked) =>
                props.updateSettings({
                  hiddenProviders: setProviderListMembership(
                    props.settings.hiddenProviders,
                    props.config.provider,
                    !checked,
                  ),
                })
              }
              aria-label={`Show ${title} in the provider picker`}
            />
          </label>
        </div>
        <div className="px-3 pt-2 text-ui-sm text-muted-foreground">
          {providerSetupStatusLabel({
            status: props.providerStatus,
            reconciled: props.activity.reconciled,
            disabled: !enabled,
          })}
          {enabled &&
          props.activity.reconciled &&
          props.providerStatus?.message &&
          (props.providerStatus.status !== "ready" ||
            props.providerStatus.authStatus !== "authenticated") ? (
            <p className="mt-1">{props.providerStatus.message}</p>
          ) : null}
        </div>
        <div className="flex min-h-11 items-center gap-2 px-3 py-2">
          <CollapsibleTrigger
            type="button"
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
          >
            <span className="min-w-0 flex-1 text-ui-lg font-medium text-foreground">
              CLI configuration
            </span>
            {isDirty ? (
              <span className="shrink-0 text-ui-sm text-muted-foreground">Custom</span>
            ) : null}
            {providerUpdateLabel ? (
              <span
                className={cn(
                  "shrink-0 text-ui-sm",
                  updateAdvisory?.status === "behind_latest"
                    ? "text-foreground"
                    : "text-muted-foreground",
                )}
              >
                {providerUpdateLabel}
              </span>
            ) : null}
            <DisclosureChevron
              open={props.open}
              className="size-4 shrink-0 text-muted-foreground"
            />
          </CollapsibleTrigger>
          {showUpdateButton && props.providerStatus ? (
            <ProviderUpdateAction
              providerStatus={props.providerStatus}
              active={updateActive}
              disabled={updateActive}
              onUpdate={props.onUpdate}
            />
          ) : null}
        </div>

        <CollapsiblePanel>
          <div className="border-t border-border/70 bg-muted/20 px-3 py-3">
            <div className="space-y-3">
              <ProviderDocsLinks docs={props.config.docs} />
              {showProviderUpdateStatus && updateAdvisory?.status === "behind_latest" ? (
                <div className="text-ui leading-snug text-muted-foreground">
                  {updateAdvisory.canUpdate && updateAdvisory.updateCommand ? (
                    <>
                      <span>Command: </span>
                      <code className="font-mono">{updateAdvisory.updateCommand}</code>
                    </>
                  ) : (
                    "A newer version is available, but Glade could not identify a safe one-click update command for this installation."
                  )}
                </div>
              ) : null}
              {showSelfManagedUpdate && props.providerStatus ? (
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 text-ui leading-snug text-muted-foreground">
                    {title} manages its own releases, so Glade cannot tell whether a newer version
                    exists. Run the update to be sure.
                  </div>
                  <ProviderUpdateAction
                    providerStatus={props.providerStatus}
                    active={updateActive}
                    disabled={updateActive}
                    onUpdate={props.onUpdate}
                  />
                </div>
              ) : null}
              {props.config.fields.map((field) => (
                <ProviderInstallFieldControl
                  key={field.settingsKey}
                  field={field}
                  settings={props.settings}
                  updateSettings={props.updateSettings}
                />
              ))}
            </div>
          </div>
        </CollapsiblePanel>
      </div>
    </Collapsible>
  );
}

export type ProvidersSettingsPanelProps = AppSettingsBinding & {
  readonly active: boolean;
  readonly resetEpoch: number;
  readonly updateSettingsAndWait: (patch: Partial<AppSettings>) => Promise<void>;
};

export function ProvidersSettingsPanel({
  settings,
  defaults,
  updateSettings,
  updateSettingsAndWait,
  active,
  resetEpoch,
}: ProvidersSettingsPanelProps) {
  const queryClient = useQueryClient();
  const localProviderStatuses = useProviderStatusesForLocalConfig();
  const refreshProviderStatuses = useRefreshProviderStatusesNow();
  const [refreshingProviders, setRefreshingProviders] = useState(false);
  const refreshProvidersInFlightRef = useRef(false);
  const providerStatusesReconciled = hasReconciledServerProviderStatuses(queryClient);
  const serverSettingsQuery = useQuery(serverSettingsQueryOptions());
  const [openInstallProviders, setOpenInstallProviders] = useState<Record<ProviderKind, boolean>>(
    () => createProviderInstallDisclosureState(settings),
  );
  const [updatingProviders, setUpdatingProviders] = useState<ReadonlySet<ProviderKind>>(
    () => new Set(),
  );
  const providerEnablementMutationInFlightRef = useRef(false);
  const [providerEnablementMutationPending, setProviderEnablementMutationPending] = useState(false);
  const hiddenProviderSet = useMemo(
    () => new Set<ProviderKind>(settings.hiddenProviders),
    [settings.hiddenProviders],
  );
  const hiddenProviderCount = hiddenProviderSet.size;
  const disabledProviderSet = useMemo(
    () => new Set<ProviderKind>(settings.disabledProviders),
    [settings.disabledProviders],
  );
  const enabledProviderCount = PROVIDER_VISIBILITY_OPTIONS.length - disabledProviderSet.size;
  const providerVisibilityOptionsByProvider = useMemo(
    () => new Map(PROVIDER_VISIBILITY_OPTIONS.map((option) => [option.provider, option])),
    [],
  );
  const orderedProviderVisibilityOptions = useMemo(
    () =>
      settings.providerOrder.flatMap((provider) => {
        const option = providerVisibilityOptionsByProvider.get(provider);
        return option ? [option] : [];
      }),
    [providerVisibilityOptionsByProvider, settings.providerOrder],
  );
  const providerVisibilitySensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );
  const isProviderOrderDirty = !sameProviderOrder(settings.providerOrder, defaults.providerOrder);
  const providerStatusByProvider = useMemo(
    () => new Map(localProviderStatuses.map((status) => [status.provider, status])),
    [localProviderStatuses],
  );
  const availableProviderCount = orderedProviderVisibilityOptions.filter(
    (option) => providerStatusByProvider.get(option.provider)?.available === true,
  ).length;
  const providerUpdateServerSettings = useMemo(
    () =>
      serverSettingsQuery.data
        ? {
            ...serverSettingsQuery.data,
            enableProviderUpdateChecks: settings.enableProviderUpdateChecks,
          }
        : null,
    [serverSettingsQuery.data, settings.enableProviderUpdateChecks],
  );
  const installSettingsDirty = isProviderInstallSettingsDirty(settings, defaults);

  const updateProviderConfiguration = useCallback(
    async (patch: Partial<AppSettings>) => {
      if (providerEnablementMutationInFlightRef.current) return;
      providerEnablementMutationInFlightRef.current = true;
      setProviderEnablementMutationPending(true);
      try {
        await updateSettingsAndWait(patch);
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Could not save provider configuration",
          description:
            error instanceof Error
              ? error.message
              : "The provider configuration could not be saved.",
        });
      } finally {
        providerEnablementMutationInFlightRef.current = false;
        setProviderEnablementMutationPending(false);
      }
    },
    [updateSettingsAndWait],
  );

  useSettingsRestoreSignal(resetEpoch, () => {
    setOpenInstallProviders(createClosedProviderInstallDisclosureState());
  });

  const handleProviderOrderDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const fromIndex = settings.providerOrder.indexOf(active.id as ProviderKind);
      const toIndex = settings.providerOrder.indexOf(over.id as ProviderKind);
      if (fromIndex < 0 || toIndex < 0) return;
      updateSettings({ providerOrder: arrayMove([...settings.providerOrder], fromIndex, toIndex) });
    },
    [settings.providerOrder, updateSettings],
  );

  const runProviderUpdate = useCallback(
    async (provider: ProviderKind) => {
      if (updatingProviders.has(provider)) return;
      setUpdatingProviders((current) => new Set(current).add(provider));
      try {
        await withProviderUpdateTimeout({
          provider,
          request: ensureNativeApi().server.updateProvider({ provider }),
        })
          .then((result) => {
            const refreshedProvider = result.providers.find(
              (status) => status.provider === provider,
            );
            const failureMessage = providerUpdateFailureMessage(refreshedProvider);
            if (failureMessage) {
              const manualCommand = refreshedProvider?.versionAdvisory?.updateCommand?.trim();
              toastManager.add({
                type: "error",
                title: `Could not update ${PROVIDER_DISPLAY_NAMES[provider]}`,
                description: manualCommand
                  ? `${failureMessage}\n\nCopy the command below to update manually in a terminal.`
                  : failureMessage,
                ...(manualCommand ? { data: { copyText: manualCommand } } : {}),
              });
              return;
            }
            toastManager.add({
              type: "success",
              title: `${PROVIDER_DISPLAY_NAMES[provider]} update finished`,
              description: "New sessions will use the refreshed provider.",
            });
          })
          .catch((error: unknown) => {
            toastManager.add({
              type: "error",
              title: `Could not update ${PROVIDER_DISPLAY_NAMES[provider]}`,
              description: error instanceof Error ? error.message : "The provider update failed.",
            });
          });
      } finally {
        await queryClient
          .invalidateQueries({ queryKey: serverQueryKeys.config() })
          .catch(() => undefined);
        setUpdatingProviders((current) => {
          const next = new Set(current);
          next.delete(provider);
          return next;
        });
      }
    },
    [queryClient, updatingProviders],
  );

  if (!active) return null;

  const refreshProviders = async () => {
    if (refreshProvidersInFlightRef.current) return;
    refreshProvidersInFlightRef.current = true;
    setRefreshingProviders(true);
    try {
      await refreshProviderStatuses();
    } finally {
      refreshProvidersInFlightRef.current = false;
      setRefreshingProviders(false);
    }
  };

  return (
    <div id={SETTINGS_TARGETS.providerUpdates} className="space-y-6">
      <SettingsSection title="Provider configuration">
        <SettingsRow
          id="setting-providers"
          title="Providers"
          description="Enable providers, choose which installed CLIs appear in the picker, and drag to reorder. Expand a provider for CLI paths, tools and setup guides. Disabling preserves chats and running turns; hiding only changes the picker."
          status={
            providerEnablementMutationPending
              ? "Saving provider activity"
              : `${enabledProviderCount} enabled · ${availableProviderCount} installed`
          }
          control={
            <Button
              variant="outline"
              size="sm"
              disabled={refreshingProviders}
              onClick={() => void refreshProviders()}
            >
              {refreshingProviders ? <Loader2Icon className="size-3.5 animate-spin" /> : null}
              {refreshingProviders ? "Checking setup" : "Refresh status"}
            </Button>
          }
          resetAction={
            (disabledProviderSet.size > 0 ||
              hiddenProviderCount > 0 ||
              isProviderOrderDirty ||
              installSettingsDirty) &&
            !providerEnablementMutationPending ? (
              <SettingResetButton
                label="provider configuration"
                onClick={() => {
                  void updateProviderConfiguration({
                    disabledProviders: defaults.disabledProviders,
                    hiddenProviders: defaults.hiddenProviders,
                    providerOrder: defaults.providerOrder,
                    ...createProviderInstallResetPatch(defaults),
                  });
                  setOpenInstallProviders(createClosedProviderInstallDisclosureState());
                }}
              />
            ) : null
          }
        >
          <DndContext
            sensors={providerVisibilitySensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis]}
            onDragEnd={handleProviderOrderDragEnd}
          >
            <SortableContext
              items={[...settings.providerOrder]}
              strategy={verticalListSortingStrategy}
            >
              <div className={cn("mt-4", SETTINGS_INSET_LIST_CLASS_NAME)}>
                {settings.providerOrder.map((provider) => {
                  const config = VISIBLE_PROVIDER_INSTALL_SETTINGS.find(
                    (entry) => entry.provider === provider,
                  );
                  if (!config) return null;
                  return (
                    <ProviderToolRow
                      key={provider}
                      config={config}
                      open={openInstallProviders[provider]}
                      settings={settings}
                      defaults={defaults}
                      hiddenProviderSet={hiddenProviderSet}
                      serverSettings={providerUpdateServerSettings}
                      providerStatus={providerStatusByProvider.get(provider)}
                      updatingProviders={updatingProviders}
                      onOpenChange={(open) =>
                        setOpenInstallProviders((existing) => ({ ...existing, [provider]: open }))
                      }
                      onUpdate={(provider) => void runProviderUpdate(provider)}
                      updateSettings={updateSettings}
                      activity={{
                        reconciled: providerStatusesReconciled,
                        pending: !serverSettingsQuery.data || providerEnablementMutationPending,
                        onEnable: (enabled) =>
                          void updateProviderConfiguration({
                            disabledProviders: setProviderListMembership(
                              settings.disabledProviders,
                              provider,
                              !enabled,
                            ),
                          }),
                      }}
                    />
                  );
                })}
              </div>
            </SortableContext>
          </DndContext>
        </SettingsRow>
      </SettingsSection>

      <div>
        <SettingsSection title="Updates">
          <SettingsRow
            title="Automatic CLI update checks"
            description="Check Codex, Claude, and other provider CLIs for newer versions in the background."
            resetAction={
              settings.enableProviderUpdateChecks !== defaults.enableProviderUpdateChecks ? (
                <SettingResetButton
                  label="CLI update checks"
                  onClick={() =>
                    updateSettings({
                      enableProviderUpdateChecks: defaults.enableProviderUpdateChecks,
                    })
                  }
                />
              ) : null
            }
            control={
              <Switch
                checked={settings.enableProviderUpdateChecks}
                onCheckedChange={(checked) =>
                  updateSettings({ enableProviderUpdateChecks: Boolean(checked) })
                }
                aria-label="Automatic CLI update checks"
              />
            }
          />
        </SettingsSection>
      </div>
    </div>
  );
}
