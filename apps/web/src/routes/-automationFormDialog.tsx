import {
  type AutomationMode,
  type AutomationNotificationPolicy,
  type AutomationWorktreeMode,
} from "@glade/contracts/automation/automation";
import { type ProviderKind } from "@glade/contracts/core/baseSchemas";
import { type ModelSelection, type RuntimeMode } from "@glade/contracts/provider/sessionPolicy";
import { automationRequiresTargetThread } from "@glade/shared/threads/automationMode";
import { normalizeModelSlug } from "@glade/shared/provider/model";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";

import { useAppSettings } from "~/appSettings";
import {
  ComposerPickerMenuPopup,
  ComposerPickerMenuSubPopup,
} from "~/components/chat/ComposerPickerMenuPopup";
import { ProviderModelPicker } from "~/components/chat/ProviderModelPicker";
import { RUNTIME_AUTO_ICON_ACCENT_CLASS_NAME } from "~/components/chat/composerPickerStyles";
import { resolveRuntimeModelDescriptor } from "~/components/chat/runtimeModelCapabilities";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Dialog, DialogPopup, DialogTitle } from "~/components/ui/dialog";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  MenuSubTrigger,
  MenuTrigger,
} from "~/components/ui/menu";
import { TimePicker } from "~/components/ui/time-picker";
import { useProviderModelCatalog } from "~/hooks/useProviderModelCatalog";
import { useProviderStatusesForLocalConfig } from "~/hooks/useProviderStatusesForLocalConfig";
import type { AutomationDraftWarning, AutomationDraftWarningId } from "~/lib/automationDraft";
import {
  automationFailurePolicyOptions,
  type AutomationFailurePolicyValue,
} from "~/lib/automationFailurePolicy";
import {
  automationFastIntervalLimitMessage,
  automationFormSubmitBlockReason,
  automationIntervalPresetOptions,
  formatCadence,
  intervalFormPartsFromSeconds,
  modelSelectionForProjectChange,
  SCHEDULE_KIND_OPTIONS,
  scheduleFromForm,
  weekdayLabel,
  type AutomationFormState,
  type ScheduleKind,
} from "~/lib/automationForm";
import { CentralIcon } from "~/lib/central-icons";
import { SkillCubeIcon, WorktreeIcon } from "~/lib/icons";
import { findProviderStatus } from "~/lib/providerAvailability";
import { resolveProviderDiscoveryCwd } from "~/lib/providerDiscovery";
import {
  normalizeRuntimeModeForProvider,
  providerModelSupportsAutoRuntimeMode,
  providerSupportsAutoRuntimeMode,
} from "~/lib/runtimeMode";
import { serverConfigQueryOptions } from "~/lib/serverReactQuery";
import { cn } from "~/lib/utils";
import { buildModelSelection } from "~/providerModelOptions";
import { useStore } from "~/store";
import type { Thread } from "~/types";
import { resolveThreadPickerTitle } from "./-chatThreadRoute.logic";
import { AUTOMATION_TEMPLATES, automationTargetThreads } from "./-automations.shared";

const CHIP_CLASS =
  "gap-1.5 rounded-lg px-2 font-normal text-[var(--color-text-foreground-secondary)]";
type CadenceOption = { readonly value: string; readonly label: string };

const MAX_ITERATION_PRESETS: readonly CadenceOption[] = [
  { value: "", label: "Unlimited" },
  { value: "10", label: "10 runs" },
  { value: "25", label: "25 runs" },
  { value: "50", label: "50 runs" },
  { value: "100", label: "100 runs" },
  { value: "250", label: "250 runs" },
];

function maxIterationLabel(value: string): string {
  return value === "1" ? "1 run" : `${value} runs`;
}

export function maxIterationOptions(
  currentValue: string | number | null | undefined,
): readonly { readonly value: string; readonly label: string }[] {
  const value = currentValue == null ? "" : String(currentValue).trim();
  if (!/^\d+$/.test(value) || MAX_ITERATION_PRESETS.some((preset) => preset.value === value)) {
    return MAX_ITERATION_PRESETS;
  }
  return [{ value, label: maxIterationLabel(value) }, ...MAX_ITERATION_PRESETS];
}

export function AutomationApprovalBanner({
  warnings,
  busy,
  onApprove,
  onApproveAndRun,
}: {
  readonly warnings: readonly AutomationDraftWarning[];
  readonly busy: boolean;
  readonly onApprove: () => void;
  readonly onApproveAndRun: () => void;
}) {
  if (warnings.length === 0) {
    return null;
  }
  return (
    <Alert variant="warning">
      <AlertTitle>Approval needed</AlertTitle>
      <AlertDescription>
        <span>
          This automation needs your approval once before Glade can save changes. When a warning
          blocks manual runs, Run now stays disabled until you approve it.
        </span>
        <ul className="flex flex-col gap-1.5">
          {warnings.map((warning) => (
            <li key={warning.id} className="text-ui leading-snug">
              <span className="font-medium text-foreground/90">{warning.title}</span>
              <span className="block">{warning.detail}</span>
            </li>
          ))}
        </ul>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onApprove}>
            Approve
          </Button>
          <Button type="button" size="sm" disabled={busy} onClick={onApproveAndRun}>
            Approve &amp; run now
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}

export function AutomationModelPicker({
  value,
  projectCwd,
  disabled,
  onChange,
  onAutoModeSupportChange,
}: {
  readonly value: ModelSelection;
  readonly projectCwd: string | null;
  readonly disabled?: boolean;
  readonly onChange: (value: ModelSelection) => void;
  readonly onAutoModeSupportChange?: (supported: boolean) => void;
}) {
  const { settings } = useAppSettings();
  const serverConfigQuery = useQuery(serverConfigQueryOptions());
  const providerStatuses = useProviderStatusesForLocalConfig();
  const [open, setOpen] = useState(false);
  const modelHintByProvider: Partial<Record<ProviderKind, string | null>> = {
    [value.provider]: value.model,
  };
  const providerModelDiscoveryCwd = resolveProviderDiscoveryCwd({
    activeThreadWorktreePath: null,
    activeProjectCwd: projectCwd,
    serverCwd: serverConfigQuery.data?.cwd ?? null,
  });
  const {
    modelOptionsByProvider,
    loadingModelProviders,
    discoveryErrorsByProvider,
    runtimeModelsByProvider,
    selectedRuntimeModel,
  } = useProviderModelCatalog({
    selectedProvider: value.provider,
    discoveryEnabled: open || !normalizeModelSlug(value.model, value.provider),
    cwd: providerModelDiscoveryCwd,
    modelHintByProvider,
  });
  const defaultModel = runtimeModelsByProvider[value.provider].find((model) => model.isDefault);
  useEffect(() => {
    if (!normalizeModelSlug(value.model, value.provider) && defaultModel) {
      onChange({
        ...value,
        model: defaultModel.slug,
      });
    }
  }, [value, defaultModel, onChange]);
  const providerStatus = findProviderStatus(providerStatuses, value.provider);
  const persistedRuntimeModel =
    value.provider === "claudeAgent" && typeof value.supportsAutoMode === "boolean"
      ? {
          slug: value.model,
          name: value.model,
          supportsAutoMode: value.supportsAutoMode,
        }
      : undefined;
  const autoModeSupported = providerModelSupportsAutoRuntimeMode(
    value.provider,
    selectedRuntimeModel ?? persistedRuntimeModel,
    providerStatus,
  );
  useEffect(() => {
    onAutoModeSupportChange?.(autoModeSupported);
  }, [autoModeSupported, onAutoModeSupportChange]);

  return (
    <ProviderModelPicker
      compact
      provider={value.provider}
      model={value.model}
      lockedProvider={null}
      providers={providerStatuses}
      modelOptionsByProvider={modelOptionsByProvider}
      loadingModelProviders={loadingModelProviders}
      discoveryErrorsByProvider={discoveryErrorsByProvider}
      hiddenProviders={settings.hiddenProviders}
      providerOrder={settings.providerOrder}
      disabled={disabled ?? false}
      open={open}
      onOpenChange={setOpen}
      onProviderModelChange={(provider, model) => {
        const runtimeModel = resolveRuntimeModelDescriptor({
          provider,
          model,
          runtimeModels: runtimeModelsByProvider[provider],
        });
        onChange(buildModelSelection(provider, model, undefined, runtimeModel?.supportsAutoMode));
      }}
    />
  );
}

function reconcileAutomationFormAutoModeSupport(
  form: AutomationFormState,
  supported: boolean,
): AutomationFormState {
  const modelSelection =
    form.modelSelection.provider === "claudeAgent" &&
    form.modelSelection.supportsAutoMode !== supported
      ? { ...form.modelSelection, supportsAutoMode: supported }
      : form.modelSelection;
  const runtimeMode =
    !supported && form.runtimeMode === "auto" ? "approval-required" : form.runtimeMode;
  return modelSelection !== form.modelSelection || runtimeMode !== form.runtimeMode
    ? { ...form, modelSelection, runtimeMode }
    : form;
}

export function AutomationDialog({
  open,
  form,
  projects,
  threads,
  warnings: warningsProp,
  acknowledgedWarningIds: acknowledgedWarningIdsProp,
  onOpenChange,
  onFormChange,
  onToggleWarning,
  onSubmit,
  busy,
}: {
  readonly open: boolean;
  readonly form: AutomationFormState;
  readonly projects: ReturnType<typeof useStore.getState>["projects"];
  readonly threads: ReadonlyArray<Pick<Thread, "id" | "projectId" | "title">>;
  readonly warnings?: readonly AutomationDraftWarning[];
  readonly acknowledgedWarningIds?: ReadonlySet<AutomationDraftWarningId>;
  readonly onOpenChange: (open: boolean) => void;
  readonly onFormChange: (form: AutomationFormState) => void;
  readonly onToggleWarning?: (id: AutomationDraftWarningId, checked: boolean) => void;
  readonly onSubmit: () => void;
  readonly busy: boolean;
}) {
  const warnings: readonly AutomationDraftWarning[] = warningsProp ?? [];
  const acknowledgedWarningIds: ReadonlySet<AutomationDraftWarningId> =
    acknowledgedWarningIdsProp ?? new Set<AutomationDraftWarningId>();
  const setField = <K extends keyof AutomationFormState>(key: K, value: AutomationFormState[K]) =>
    onFormChange({ ...form, [key]: value });
  const projectThreads = automationTargetThreads(threads, form.projectId);
  const selectedProject = projects.find((project) => project.id === form.projectId);
  const [selectedModelSupportsAuto, setSelectedModelSupportsAuto] = useState(() =>
    form.modelSelection.provider === "claudeAgent"
      ? form.modelSelection.supportsAutoMode !== false
      : providerSupportsAutoRuntimeMode(form.modelSelection.provider),
  );
  const handleAutoModeSupportChange = useCallback(
    (supported: boolean) => {
      setSelectedModelSupportsAuto(supported);
      const reconciled = reconcileAutomationFormAutoModeSupport(form, supported);
      if (reconciled !== form) {
        onFormChange(reconciled);
      }
    },
    [form, onFormChange],
  );
  const schedule = scheduleFromForm(form);
  const fastIntervalLimitMessage = automationFastIntervalLimitMessage(form);
  const submitBlockReason = automationFormSubmitBlockReason(form, warnings, acknowledgedWarningIds);
  const submittable =
    submitBlockReason === null &&
    !!normalizeModelSlug(form.modelSelection.model, form.modelSelection.provider);
  const maxIterationPresets = maxIterationOptions(form.maxIterations);
  const intervalAmount = Number.parseInt(form.intervalAmount, 10);
  const intervalSeconds = Number.isFinite(intervalAmount)
    ? form.intervalUnit === "seconds"
      ? intervalAmount
      : intervalAmount * 60
    : undefined;

  const intervalPresetOptions = automationIntervalPresetOptions({
    currentSeconds: intervalSeconds,
    includeHourly: false,
  });

  const chooseProject = (projectId: string) => {
    const targetStillMatches =
      form.targetThreadId.length > 0 &&
      threads.some((thread) => thread.id === form.targetThreadId && thread.projectId === projectId);
    const modelSelection = modelSelectionForProjectChange(
      projects,
      form.projectId,
      projectId,
      form.modelSelection,
    );
    onFormChange({
      ...form,
      projectId,
      modelSelection,
      runtimeMode: normalizeRuntimeModeForProvider(form.runtimeMode, modelSelection.provider),
      targetThreadId: targetStillMatches ? form.targetThreadId : "",
    });
  };

  const applyTemplate = (template: (typeof AUTOMATION_TEMPLATES)[number]) =>
    onFormChange({
      ...form,
      name: form.name.trim() ? form.name : template.name,
      prompt: template.prompt,
    });

  const submit = () => {
    if (busy || !submittable) return;
    onSubmit();
  };
  const handleOpenChange = (nextOpen: boolean) => {
    if (busy && !nextOpen) return;
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogPopup showCloseButton={false} className="max-w-3xl">
        <DialogTitle className="sr-only">New automation</DialogTitle>

        <div className="flex items-start gap-3 px-5 pt-5">
          <input
            value={form.name}
            onChange={(event) => setField("name", event.target.value)}
            placeholder="Automation title"
            aria-label="Automation title"
            autoFocus
            className="min-w-0 flex-1 bg-transparent py-1 font-system-ui text-lg font-medium text-foreground outline-none placeholder:text-muted-foreground/50"
          />
          <div className="flex shrink-0 items-center gap-1.5">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="About automations"
              title="Automations run this prompt on a schedule and open the result as a thread."
            >
              <CentralIcon name="info-simple" className="size-4" />
            </Button>
            <Menu>
              <MenuTrigger render={<Button variant="outline" size="sm" />}>
                Use template
              </MenuTrigger>
              <ComposerPickerMenuPopup align="end" className="w-52">
                {AUTOMATION_TEMPLATES.map((template) => (
                  <MenuItem key={template.label} onClick={() => applyTemplate(template)}>
                    {template.label}
                  </MenuItem>
                ))}
              </ComposerPickerMenuPopup>
            </Menu>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Close"
              disabled={busy}
              onClick={() => onOpenChange(false)}
            >
              <CentralIcon name="cross-small" className="size-4" />
            </Button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-3">
          <textarea
            value={form.prompt}
            onChange={(event) => setField("prompt", event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                submit();
              }
            }}
            placeholder="Add prompt e.g. look for crashes in $sentry"
            aria-label="Automation prompt"
            className="min-h-[15rem] w-full flex-1 resize-none overflow-y-auto bg-transparent font-system-ui text-ui leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/50"
          />

          {warnings.length > 0 ? (
            <div className="mt-2 flex flex-col gap-1.5 border-t border-border/50 pt-3">
              {warnings.map((warning) => (
                <label
                  key={warning.id}
                  className="flex items-start gap-2 text-ui leading-snug text-muted-foreground"
                >
                  {warning.requiresAcknowledgement ? (
                    <input
                      type="checkbox"
                      checked={acknowledgedWarningIds.has(warning.id)}
                      onChange={(event) => onToggleWarning?.(warning.id, event.target.checked)}
                      className="mt-0.5"
                    />
                  ) : (
                    <span className="mt-1 size-1.5 shrink-0 rounded-full bg-amber-500" />
                  )}
                  <span className="min-w-0">
                    <span className="font-medium text-foreground">{warning.title}</span>
                    <span className="block">{warning.detail}</span>
                  </span>
                </label>
              ))}
            </div>
          ) : null}
          {fastIntervalLimitMessage ? (
            <div className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-ui leading-snug text-amber-700 dark:text-amber-300">
              {fastIntervalLimitMessage}
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2 px-4 pb-4 pt-1">
          <div className="flex flex-1 flex-wrap items-center gap-0.5">
            {}
            {automationRequiresTargetThread(form.mode) ? null : (
              <Menu>
                <MenuTrigger render={<Button variant="ghost" size="sm" className={CHIP_CLASS} />}>
                  <WorktreeIcon className="size-4" />
                  <span className="capitalize">{form.worktreeMode}</span>
                  <CentralIcon name="chevron-down-small" className="size-3.5 opacity-60" />
                </MenuTrigger>
                <ComposerPickerMenuPopup align="start" className="w-40">
                  <MenuRadioGroup
                    value={form.worktreeMode}
                    onValueChange={(value) =>
                      setField("worktreeMode", value as AutomationWorktreeMode)
                    }
                  >
                    {(["auto", "worktree", "local"] as const).map((value) => (
                      <MenuRadioItem key={value} value={value}>
                        <span className="capitalize">{value}</span>
                      </MenuRadioItem>
                    ))}
                  </MenuRadioGroup>
                </ComposerPickerMenuPopup>
              </Menu>
            )}

            <Menu>
              <MenuTrigger render={<Button variant="ghost" size="sm" className={CHIP_CLASS} />}>
                <CentralIcon name="folder-2" className="size-4" />
                <span className="max-w-[10rem] truncate">
                  {selectedProject?.name ?? "Select project"}
                </span>
                <CentralIcon name="chevron-down-small" className="size-3.5 opacity-60" />
              </MenuTrigger>
              <ComposerPickerMenuPopup align="start" className="w-56">
                <MenuRadioGroup value={form.projectId} onValueChange={chooseProject}>
                  {projects.map((project) => (
                    <MenuRadioItem key={project.id} value={project.id}>
                      <span className="truncate">{project.name}</span>
                    </MenuRadioItem>
                  ))}
                </MenuRadioGroup>
              </ComposerPickerMenuPopup>
            </Menu>

            <AutomationModelPicker
              value={form.modelSelection}
              projectCwd={selectedProject?.cwd ?? null}
              onChange={(value) => {
                onFormChange({
                  ...form,
                  modelSelection: value,
                  runtimeMode: normalizeRuntimeModeForProvider(form.runtimeMode, value.provider),
                });
              }}
              onAutoModeSupportChange={handleAutoModeSupportChange}
            />

            <Menu>
              <MenuTrigger render={<Button variant="ghost" size="sm" className={CHIP_CLASS} />}>
                <CentralIcon name="clock" className="size-4" />
                <span>{formatCadence(schedule)}</span>
                <CentralIcon name="chevron-down-small" className="size-3.5 opacity-60" />
              </MenuTrigger>
              <ComposerPickerMenuPopup align="start" className="w-56">
                <MenuGroup>
                  <MenuGroupLabel>Schedule</MenuGroupLabel>
                  <MenuRadioGroup
                    value={form.scheduleKind}
                    onValueChange={(value) => setField("scheduleKind", value as ScheduleKind)}
                  >
                    {SCHEDULE_KIND_OPTIONS.map((option) => (
                      <MenuRadioItem key={option.value} value={option.value}>
                        {option.label}
                      </MenuRadioItem>
                    ))}
                  </MenuRadioGroup>
                </MenuGroup>
                {form.scheduleKind === "custom" ? (
                  <>
                    <MenuSeparator />
                    <MenuGroup>
                      <MenuGroupLabel>Every</MenuGroupLabel>
                      <MenuRadioGroup
                        value={intervalSeconds === undefined ? "" : String(intervalSeconds)}
                        onValueChange={(value) => {
                          const seconds = Number.parseInt(value, 10);
                          if (!Number.isFinite(seconds) || seconds <= 0) return;
                          const parts = intervalFormPartsFromSeconds(seconds);
                          onFormChange({
                            ...form,
                            intervalUnit: parts.unit,
                            intervalAmount: parts.amount,
                          });
                        }}
                      >
                        {intervalPresetOptions.map((preset) => (
                          <MenuRadioItem key={preset.value} value={preset.value}>
                            {preset.label}
                          </MenuRadioItem>
                        ))}
                      </MenuRadioGroup>
                    </MenuGroup>
                  </>
                ) : null}
                {form.scheduleKind === "once" ? (
                  <>
                    <MenuSeparator />
                    <MenuGroup>
                      <MenuGroupLabel>Run at</MenuGroupLabel>
                      <div className="px-2 py-1">
                        <input
                          type="datetime-local"
                          step={1}
                          value={form.onceRunAt}
                          onChange={(event) => setField("onceRunAt", event.target.value)}
                          className="w-full rounded-md border border-border bg-transparent px-2 py-1.5 text-ui leading-snug outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        />
                      </div>
                    </MenuGroup>
                  </>
                ) : null}
                {form.scheduleKind === "cron" ? (
                  <>
                    <MenuSeparator />
                    <MenuGroup>
                      <MenuGroupLabel>Cron</MenuGroupLabel>
                      <div className="px-2 py-1">
                        <input
                          value={form.cronExpression}
                          onChange={(event) => setField("cronExpression", event.target.value)}
                          placeholder="0 9 * * *"
                          className="w-full rounded-md border border-border bg-transparent px-2 py-1.5 text-ui leading-snug outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        />
                      </div>
                    </MenuGroup>
                  </>
                ) : null}
                {form.scheduleKind === "weekly" ? (
                  <>
                    <MenuSeparator />
                    <MenuGroup>
                      <MenuGroupLabel>Day</MenuGroupLabel>
                      <MenuRadioGroup
                        value={form.dayOfWeek}
                        onValueChange={(value) => setField("dayOfWeek", value)}
                      >
                        {[0, 1, 2, 3, 4, 5, 6].map((value) => (
                          <MenuRadioItem key={value} value={String(value)}>
                            {weekdayLabel(value)}
                          </MenuRadioItem>
                        ))}
                      </MenuRadioGroup>
                    </MenuGroup>
                  </>
                ) : null}
                {form.scheduleKind === "daily" ||
                form.scheduleKind === "weekdays" ||
                form.scheduleKind === "weekly" ? (
                  <>
                    <MenuSeparator />
                    <MenuSub>
                      <MenuSubTrigger>
                        Time
                        <span className="ml-auto pr-1 tabular-nums text-muted-foreground">
                          {form.timeOfDay}
                        </span>
                      </MenuSubTrigger>
                      <ComposerPickerMenuSubPopup>
                        <div className="p-1">
                          <TimePicker
                            className="w-44"
                            value={form.timeOfDay}
                            onChange={(value) => setField("timeOfDay", value)}
                          />
                        </div>
                      </ComposerPickerMenuSubPopup>
                    </MenuSub>
                  </>
                ) : null}
                {form.scheduleKind === "daily" ||
                form.scheduleKind === "weekdays" ||
                form.scheduleKind === "weekly" ||
                form.scheduleKind === "cron" ? (
                  <>
                    <MenuSeparator />
                    <MenuGroup>
                      <MenuGroupLabel>Timezone</MenuGroupLabel>
                      <div className="px-2 py-1">
                        <input
                          value={form.timezone}
                          onChange={(event) => setField("timezone", event.target.value)}
                          placeholder="Europe/Rome"
                          className="w-full rounded-md border border-border bg-transparent px-2 py-1.5 text-ui leading-snug outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        />
                      </div>
                    </MenuGroup>
                  </>
                ) : null}
              </ComposerPickerMenuPopup>
            </Menu>

            <Menu>
              <MenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Run mode"
                    title="Run mode"
                    className="rounded-lg text-[var(--color-text-foreground-secondary)]"
                  />
                }
              >
                <SkillCubeIcon className="size-4" />
              </MenuTrigger>
              <ComposerPickerMenuPopup align="start" className="w-56">
                <MenuGroup>
                  <MenuGroupLabel>Mode</MenuGroupLabel>
                  <MenuRadioGroup
                    value={form.mode}
                    onValueChange={(value) => setField("mode", value as AutomationMode)}
                  >
                    <MenuRadioItem value="standalone">Standalone</MenuRadioItem>
                    <MenuRadioItem value="dedicated">Dedicated thread</MenuRadioItem>
                    <MenuRadioItem value="heartbeat">Heartbeat</MenuRadioItem>
                  </MenuRadioGroup>
                </MenuGroup>
                {}
                {automationRequiresTargetThread(form.mode) ? (
                  <>
                    <MenuSeparator />
                    <MenuGroup>
                      <MenuGroupLabel>Target thread</MenuGroupLabel>
                      {projectThreads.length === 0 ? (
                        <MenuItem disabled>No threads in this project</MenuItem>
                      ) : (
                        <MenuRadioGroup
                          value={form.targetThreadId}
                          onValueChange={(value) => setField("targetThreadId", value)}
                        >
                          {projectThreads.map((thread) => (
                            <MenuRadioItem key={thread.id} value={thread.id}>
                              <span className="truncate">
                                {resolveThreadPickerTitle(thread.title)}
                              </span>
                            </MenuRadioItem>
                          ))}
                        </MenuRadioGroup>
                      )}
                    </MenuGroup>
                  </>
                ) : null}
                <MenuSeparator />
                <MenuGroup>
                  <MenuGroupLabel>Stop when</MenuGroupLabel>
                  <div className="px-2 py-1">
                    <input
                      value={form.stopWhen}
                      onChange={(event) => setField("stopWhen", event.target.value)}
                      placeholder="PR is ready to merge"
                      className="w-full rounded-md border border-border bg-transparent px-2 py-1.5 text-ui leading-snug outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    />
                  </div>
                </MenuGroup>
                <MenuSeparator />
                <MenuGroup>
                  <MenuGroupLabel>On failure</MenuGroupLabel>
                  <MenuRadioGroup
                    value={form.stopAfterFailures}
                    onValueChange={(value) =>
                      setField("stopAfterFailures", value as AutomationFailurePolicyValue)
                    }
                  >
                    {automationFailurePolicyOptions(form.stopAfterFailures).map((option) => (
                      <MenuRadioItem key={option.value} value={option.value}>
                        {option.label}
                      </MenuRadioItem>
                    ))}
                  </MenuRadioGroup>
                </MenuGroup>
                <MenuSeparator />
                <MenuGroup>
                  <MenuGroupLabel>Max iterations</MenuGroupLabel>
                  <MenuRadioGroup
                    value={form.maxIterations}
                    onValueChange={(value) => setField("maxIterations", value)}
                  >
                    {maxIterationPresets.map((preset) => (
                      <MenuRadioItem key={preset.value || "unlimited"} value={preset.value}>
                        {preset.label}
                      </MenuRadioItem>
                    ))}
                  </MenuRadioGroup>
                </MenuGroup>
                <MenuSeparator />
                <MenuGroup>
                  <MenuGroupLabel>Notify</MenuGroupLabel>
                  <MenuRadioGroup
                    value={form.notificationPolicy}
                    onValueChange={(value) =>
                      setField("notificationPolicy", value as AutomationNotificationPolicy)
                    }
                  >
                    <MenuRadioItem value="all">All runs</MenuRadioItem>
                    <MenuRadioItem value="failed-runs-only">Failed runs only</MenuRadioItem>
                  </MenuRadioGroup>
                </MenuGroup>
              </ComposerPickerMenuPopup>
            </Menu>

            <Menu>
              <MenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Permissions"
                    title="Permissions"
                    className="rounded-lg text-[var(--color-text-foreground-secondary)]"
                  />
                }
              >
                <CentralIcon
                  name={
                    form.runtimeMode === "auto"
                      ? "shield-code"
                      : form.runtimeMode === "full-access"
                        ? "shield-access"
                        : "brain"
                  }
                  className={cn(
                    "size-4",
                    form.runtimeMode === "auto" && RUNTIME_AUTO_ICON_ACCENT_CLASS_NAME,
                  )}
                />
              </MenuTrigger>
              <ComposerPickerMenuPopup align="start" className="w-48">
                <MenuRadioGroup
                  value={form.runtimeMode}
                  onValueChange={(value) => setField("runtimeMode", value as RuntimeMode)}
                >
                  <MenuRadioItem value="approval-required">Approval required</MenuRadioItem>
                  {selectedModelSupportsAuto ? (
                    <MenuRadioItem value="auto">
                      <CentralIcon
                        name="shield-code"
                        className={cn("size-4", RUNTIME_AUTO_ICON_ACCENT_CLASS_NAME)}
                      />
                      Auto
                    </MenuRadioItem>
                  ) : null}
                  <MenuRadioItem value="full-access">Full access</MenuRadioItem>
                </MenuRadioGroup>
              </ComposerPickerMenuPopup>
            </Menu>
          </div>

          <div className="flex min-w-0 shrink-0 items-center gap-2">
            {submitBlockReason ? (
              <span
                className="min-w-0 truncate text-ui leading-snug text-muted-foreground"
                role="status"
              >
                {submitBlockReason}
              </span>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={submit}
              disabled={busy || !submittable}
              title={submitBlockReason ?? undefined}
            >
              Create
            </Button>
          </div>
        </div>
      </DialogPopup>
    </Dialog>
  );
}
