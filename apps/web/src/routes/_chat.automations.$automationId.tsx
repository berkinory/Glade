import {
  type AutomationDefinition,
  type AutomationUpdateInput,
  type AutomationWorktreeMode,
} from "@glade/contracts/automation/automation";
import { type ModelSelection } from "@glade/contracts/provider/sessionPolicy";
import { type ThreadId } from "@glade/contracts/core/baseSchemas";
import {
  automationContinuationThreadId,
  automationRequiresTargetThread,
} from "@glade/shared/threads/automationMode";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";

import { getProviderStartOptions, useAppSettings } from "~/appSettings";
import {
  AutomationNameField,
  AutomationPromptField,
  AutomationSaveStatus,
} from "~/components/automation/AutomationHeadingFields";
import {
  DetailGroup,
  DetailRow,
  EditRow,
  INLINE_CONTROL_CLASS,
  InlineCommitTextInput,
  InlineSelect,
  InlineTime,
  MODE_LABELS,
  StatusValue,
  WORKTREE_OPTIONS,
  worktreeModeLabel,
} from "~/components/automation/automationInlineFields";
import { AutomationProposalActions } from "~/components/automation/AutomationProposalActions";
import { AutomationRiskConfirmPopover } from "~/components/automation/AutomationRiskConfirmPopover";
import {
  CHAT_SURFACE_HEADER_DIVIDER_CLASS_NAME,
  CHAT_SURFACE_HEADER_HEIGHT_CLASS,
  CHAT_SURFACE_HEADER_PADDING_X_CLASS,
} from "~/components/chat/chatHeaderControls";
import { CHAT_BACKGROUND_CLASS_NAME } from "~/components/chat/composerPickerStyles";
import { SidebarHeaderNavigationControls } from "~/components/SidebarHeaderNavigationControls";
import { Button } from "~/components/ui/button";
import { RouteInsetSurface } from "~/components/RouteInsetSurface";
import { automationApprovalGaps, buildAutomationDraftWarnings } from "~/lib/automationDraft";
import {
  automationFailurePolicyOptions,
  automationFailurePolicyValue,
  stopAfterConsecutiveFailuresFromPolicyValue,
} from "~/lib/automationFailurePolicy";
import { automationCronExpressionError, automationTimezoneError } from "~/lib/automationForm";
import {
  completionPolicyFromStopWhen,
  stopWhenFromCompletionPolicy,
} from "../features/automations/completionPolicy";
import { canPauseAutomation } from "~/lib/automationStatus";
import {
  useDesktopTopBarTrafficLightGutterClassName,
  useDesktopTopBarWindowControlsGutterClassName,
} from "~/hooks/useDesktopTopBarGutter";
import { CentralIcon } from "~/lib/central-icons";
import { cn } from "~/lib/utils";
import { ensureNativeApi } from "~/nativeApi";
import { useStore } from "~/store";
import { createSidebarThreadSummariesSelector } from "~/storeSelectors";
import {
  automationIntervalPresetOptions,
  automationTargetThreads,
  datetimeLocalFromIso,
  isoFromDatetimeLocal,
  providerOptionsForAutomationModelSelection,
  SCHEDULE_KIND_OPTIONS,
  scheduleFromKind,
  scheduleKindFromSchedule,
  updateWeeklyScheduleDay,
  updateWeeklyScheduleTime,
  useAutomations,
  weekdayLabel,
} from "./-automations.shared";
import { resolveThreadPickerTitle } from "./-chatThreadRoute.logic";
import { ModelOptionRows, RunRow } from "./-automationDetailRows";
import {
  AutomationApprovalBanner,
  AutomationModelPicker,
  maxIterationOptions,
} from "./-automationFormDialog";
import {
  lastFinishedRun,
  formatRunTimestamp,
  automationStatusDisplay,
  automationStoppedExplanation,
  trimDraft,
} from "./-automationDetailPresentation";

export const Route = createFileRoute("/_chat/automations/$automationId")({
  component: AutomationDetailView,
});

const selectAllThreads = createSidebarThreadSummariesSelector();

function AutomationDetailView() {
  const { automationId } = Route.useParams();
  const navigate = useNavigate();
  const { settings } = useAppSettings();
  const desktopTopBarTrafficLightGutterClassName = useDesktopTopBarTrafficLightGutterClassName();
  const desktopTopBarWindowControlsGutterClassName =
    useDesktopTopBarWindowControlsGutterClassName();
  const projects = useStore((state) => state.projects);
  const threads = useStore(selectAllThreads);

  const [pendingWorktreeChange, setPendingWorktreeChange] = useState<AutomationWorktreeMode | null>(
    null,
  );
  const [pendingModeChange, setPendingModeChange] = useState<{
    readonly mode: AutomationDefinition["mode"];
    readonly targetThreadId: string;
  } | null>(null);
  const worktreeAnchorRef = useRef<HTMLElement | null>(null);
  const modeAnchorRef = useRef<HTMLElement | null>(null);

  const {
    data,
    updateMutation,
    deleteMutation,
    runNowMutation,
    cancelRunMutation,
    markRunReadMutation,
    archiveRunMutation,
    runsByAutomationId,
  } = useAutomations();

  const definition = data.definitions.find((candidate) => candidate.id === automationId) ?? null;
  const runs = runsByAutomationId.get(automationId) ?? [];
  const memoryQuery = useQuery({
    queryKey: ["automation-memory", automationId],
    queryFn: () =>
      definition
        ? ensureNativeApi().automation.getMemory({ automationId: definition.id })
        : Promise.resolve(null),
    enabled: definition !== null,
  });
  const streamedMemory =
    (data.memories ?? []).find((candidate) => candidate.automationId === automationId) ?? null;
  const memory = streamedMemory ?? memoryQuery.data ?? null;
  const providerOptionsForDispatch = getProviderStartOptions(settings);

  if (!definition) {
    return (
      <RouteInsetSurface>
        <div
          className={cn(
            "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
            CHAT_BACKGROUND_CLASS_NAME,
          )}
        >
          <header
            className={cn(
              CHAT_SURFACE_HEADER_PADDING_X_CLASS,
              CHAT_SURFACE_HEADER_DIVIDER_CLASS_NAME,
              "drag-region",
              desktopTopBarTrafficLightGutterClassName,
              desktopTopBarWindowControlsGutterClassName,
            )}
          >
            <div
              className={cn("flex items-center gap-2 sm:gap-3", CHAT_SURFACE_HEADER_HEIGHT_CLASS)}
            >
              <SidebarHeaderNavigationControls />
              <h1 className="truncate font-heading text-ui-lg font-medium">Automations</h1>
            </div>
          </header>
          <main className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 text-ui leading-snug text-muted-foreground">
            Automation not found.
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void navigate({ to: "/automations" })}
            >
              Back to automations
            </Button>
          </main>
        </div>
      </RouteInsetSurface>
    );
  }

  const project = projects.find((candidate) => candidate.id === definition.projectId);
  const continuationThreadId = automationContinuationThreadId(definition);
  const continuedThread = threads.find((candidate) => candidate.id === continuationThreadId);
  // Heartbeat inherits its thread's environment, so it never picks one. A dedicated automation still
  // picks freely until its first run claims a thread: after that every run reuses that thread, so its
  // project and checkout are fixed.
  const ownsItsEnvironment = !automationRequiresTargetThread(definition.mode);
  const canChooseEnvironment = ownsItsEnvironment && continuationThreadId === null;
  const sourceThread = definition.sourceThreadId
    ? threads.find((candidate) => candidate.id === definition.sourceThreadId)
    : null;
  const lastRun = lastFinishedRun(runs);
  const schedule = definition.schedule;
  const status = automationStatusDisplay(definition);
  const stoppedExplanation = automationStoppedExplanation(definition);
  const stopWhen = stopWhenFromCompletionPolicy(definition.completionPolicy ?? { type: "none" });
  const pendingProposal = definition.proposalState === "pending";
  const stoppedAfterFailures = !definition.enabled && definition.disabledReason === "failures";

  const editable = !pendingProposal;
  const editDisabledTitle = editable ? undefined : "Accept the automation proposal first";

  const patch = (input: Omit<AutomationUpdateInput, "id">) =>
    updateMutation.mutate({ id: definition.id, ...input });

  const approvalGaps = automationApprovalGaps({
    schedule: definition.schedule,
    enabled: definition.enabled,
    maxIterations: definition.maxIterations,
    mode: definition.mode,
    runtimeMode: definition.runtimeMode,
    worktreeMode: definition.worktreeMode,
    prompt: definition.prompt,
    acknowledgedRisks: definition.acknowledgedRisks,
  });
  const approveAutomationRisks = () =>
    // Records consent and any server-required fast-loop cap. Pause/resume stays separate so approving
    // never silently re-enables an automation the user deliberately paused.
    updateMutation.mutateAsync({
      id: definition.id,
      acknowledgedRisks: approvalGaps.acknowledgedRisks,
      ...(approvalGaps.maxIterations !== undefined
        ? { maxIterations: approvalGaps.maxIterations }
        : {}),
    });
  const handleApproveAndRunNow = async () => {
    try {
      await approveAutomationRisks();
    } catch {
      return;
    }
    runNowMutation.mutate(definition);
  };
  const approvalBusy = updateMutation.isPending || runNowMutation.isPending;

  const applyModelSelection = (nextModelSelection: ModelSelection) => {
    const providerOptions = providerOptionsForAutomationModelSelection(
      definition,
      nextModelSelection,
      providerOptionsForDispatch,
    );
    patch({
      modelSelection: nextModelSelection,
      ...(providerOptions ? { providerOptions } : {}),
    });
  };

  // Editing "Runs in" to a mode that can touch the project checkout needs one-time consent; the
  // confirm patches worktreeMode and the acknowledgement atomically because the server validates risk
  // acknowledgements against the merged definition.
  const requestWorktreeChange = (value: AutomationWorktreeMode) => {
    if (
      (value === "local" || value === "auto") &&
      !definition.acknowledgedRisks.includes("local-checkout")
    ) {
      setPendingWorktreeChange(value);
      return;
    }
    patch({ worktreeMode: value });
  };
  const confirmWorktreeChange = () => {
    if (!pendingWorktreeChange) return;
    patch({
      worktreeMode: pendingWorktreeChange,
      acknowledgedRisks: [...definition.acknowledgedRisks, "local-checkout"],
    });
    setPendingWorktreeChange(null);
  };

  const pendingWorktreeWarning = pendingWorktreeChange
    ? buildAutomationDraftWarnings({
        schedule: definition.schedule,
        mode: definition.mode,
        runtimeMode: definition.runtimeMode,
        worktreeMode: pendingWorktreeChange,
        hasEphemeralContext: false,
        generatedConfidence: null,
        generatedNeedsConfirmation: false,
        prompt: definition.prompt,
      }).find((warning) => warning.id === "local-checkout")
    : undefined;

  const projectThreads = automationTargetThreads(threads, definition.projectId);
  const requestModeChange = (nextMode: AutomationDefinition["mode"]) => {
    if (nextMode === definition.mode) return;
    if (nextMode === "heartbeat") {
      setPendingModeChange({ mode: nextMode, targetThreadId: projectThreads[0]?.id ?? "" });
      return;
    }
    if (continuationThreadId !== null) {
      setPendingModeChange({ mode: nextMode, targetThreadId: "" });
      return;
    }
    patch({ mode: nextMode, targetThreadId: null });
  };
  const confirmModeChange = () => {
    if (!pendingModeChange) return;
    patch(
      pendingModeChange.mode === "heartbeat"
        ? { mode: "heartbeat", targetThreadId: pendingModeChange.targetThreadId as ThreadId }
        : { mode: pendingModeChange.mode, targetThreadId: null },
    );
    setPendingModeChange(null);
  };
  const continuedThreadTitle = continuedThread
    ? resolveThreadPickerTitle(continuedThread.title)
    : null;

  const togglePause = () => {
    updateMutation.mutate({ id: definition.id, enabled: !definition.enabled });
  };

  const deleteDefinition = async () => {
    const confirmed = await ensureNativeApi().dialogs.confirm(`Delete "${definition.name}"?`);
    if (!confirmed) return;
    deleteMutation.mutate(definition, {
      onSuccess: () => void navigate({ to: "/automations" }),
    });
  };

  return (
    <RouteInsetSurface>
      <div
        className={cn(
          "flex min-h-0 min-w-0 flex-1 flex-row overflow-hidden",
          CHAT_BACKGROUND_CLASS_NAME,
        )}
      >
        {}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <header
            className={cn(
              CHAT_SURFACE_HEADER_PADDING_X_CLASS,
              CHAT_SURFACE_HEADER_DIVIDER_CLASS_NAME,
              "drag-region",
              desktopTopBarTrafficLightGutterClassName,
            )}
          >
            <div
              className={cn("flex items-center gap-2 sm:gap-3", CHAT_SURFACE_HEADER_HEIGHT_CLASS)}
            >
              <SidebarHeaderNavigationControls />
              <div className="flex min-w-0 flex-1 items-center gap-1.5 text-ui-lg [-webkit-app-region:no-drag]">
                <button
                  type="button"
                  onClick={() => void navigate({ to: "/automations" })}
                  className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
                >
                  Automations
                </button>
                <CentralIcon
                  name="chevron-right-small"
                  className="size-3.5 shrink-0 text-muted-foreground"
                />
                <span className="truncate font-heading font-medium">{definition.name}</span>
              </div>
            </div>
          </header>

          <main className="min-h-0 flex-1 overflow-y-auto px-6 py-8 sm:px-8">
            <div className="max-w-3xl space-y-4">
              <AutomationNameField
                value={definition.name}
                onCommit={(value) => patch({ name: value })}
                disabled={!editable}
                title={editDisabledTitle}
              />
              <AutomationPromptField
                value={definition.prompt}
                onCommit={(value) => patch({ prompt: value })}
                disabled={!editable}
                title={editDisabledTitle}
              />
              <AutomationSaveStatus
                saving={updateMutation.isPending}
                failed={updateMutation.isError}
              />
              {pendingProposal ? (
                <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-[var(--color-background-elevated-primary)] p-4">
                  <div className="min-w-0">
                    <p className="text-ui-lg font-medium text-foreground">Suggested automation</p>
                    <p className="text-ui leading-snug text-muted-foreground">
                      Accept it before it can run, or dismiss it to archive the suggestion.
                    </p>
                  </div>
                  <AutomationProposalActions
                    automationId={definition.id}
                    onResolved={(resolution) => {
                      if (resolution === "dismissed") {
                        void navigate({ to: "/automations" });
                      }
                    }}
                  />
                </div>
              ) : null}
            </div>
          </main>
        </div>

        {}
        <div className="flex min-h-0 w-80 shrink-0 flex-col overflow-hidden">
          <header
            className={cn(
              CHAT_SURFACE_HEADER_PADDING_X_CLASS,
              CHAT_SURFACE_HEADER_DIVIDER_CLASS_NAME,
              "drag-region",
              desktopTopBarWindowControlsGutterClassName,
            )}
          >
            <div
              className={cn(
                "flex items-center justify-end gap-2 sm:gap-3",
                CHAT_SURFACE_HEADER_HEIGHT_CLASS,
              )}
            >
              <div className="flex shrink-0 items-center gap-1 [-webkit-app-region:no-drag]">
                {!pendingProposal && canPauseAutomation(definition) ? (
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={definition.enabled ? "Pause" : "Resume"}
                    title={definition.enabled ? "Pause" : "Resume"}
                    onClick={togglePause}
                  >
                    <CentralIcon name={definition.enabled ? "pause" : "play"} className="size-4" />
                  </Button>
                ) : null}
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Delete"
                  title="Delete"
                  onClick={() => void deleteDefinition()}
                >
                  <CentralIcon name="trash-can-simple" className="size-4" />
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="ml-1.5"
                  disabled={
                    runNowMutation.isPending ||
                    pendingProposal ||
                    stoppedAfterFailures ||
                    updateMutation.isPending ||
                    approvalGaps.runBlockingWarnings.length > 0
                  }
                  title={
                    pendingProposal
                      ? "Accept the automation proposal first"
                      : stoppedAfterFailures
                        ? "Re-enable the automation first"
                        : approvalGaps.runBlockingWarnings.length > 0
                          ? "Approve the automation first"
                          : undefined
                  }
                  onClick={() => runNowMutation.mutate(definition)}
                >
                  <CentralIcon name="play" className="size-4" />
                  Run now
                </Button>
              </div>
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto border-l border-[var(--app-surface-divider)]">
            <div className="flex flex-col gap-6 px-4 py-8">
              <AutomationApprovalBanner
                warnings={approvalGaps.warnings}
                busy={approvalBusy}
                onApprove={() => void approveAutomationRisks().catch(() => undefined)}
                onApproveAndRun={() => void handleApproveAndRunNow()}
              />
              <DetailGroup title="Status">
                <DetailRow label="Status">
                  <StatusValue>
                    <span className={cn("size-1.5 rounded-full", status.dotClassName)} />
                    {status.label}
                  </StatusValue>
                </DetailRow>
                <DetailRow label="Next run">
                  {definition.enabled && definition.nextRunAt ? (
                    <StatusValue tone="muted">
                      {formatRunTimestamp(definition.nextRunAt)}
                    </StatusValue>
                  ) : (
                    "—"
                  )}
                </DetailRow>
                <DetailRow label="Last ran">
                  {lastRun ? (
                    <StatusValue tone="muted">
                      {formatRunTimestamp(lastRun.finishedAt ?? lastRun.startedAt)}
                    </StatusValue>
                  ) : (
                    "—"
                  )}
                </DetailRow>
                {stoppedExplanation ? (
                  <div className="mx-1.5 mt-1.5 flex flex-col gap-2 rounded-md border border-border bg-foreground/[0.03] p-2.5">
                    <div className="space-y-0.5">
                      <p className="text-ui leading-snug text-foreground">{stoppedExplanation}</p>
                      {definition.disabledAt ? (
                        <p className="text-ui-sm text-muted-foreground">
                          {formatRunTimestamp(definition.disabledAt)}
                        </p>
                      ) : null}
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="self-start"
                      disabled={!editable || updateMutation.isPending}
                      title={editDisabledTitle}
                      onClick={() => patch({ enabled: true })}
                    >
                      Re-enable
                    </Button>
                  </div>
                ) : null}
              </DetailGroup>

              {}
              <DetailGroup title="Details">
                {!ownsItsEnvironment ? (
                  <DetailRow label="Runs in">Thread</DetailRow>
                ) : !canChooseEnvironment ? (
                  <DetailRow label="Runs in">
                    {worktreeModeLabel(definition.worktreeMode)}
                  </DetailRow>
                ) : (
                  <EditRow
                    label={
                      <>
                        Runs in
                        <CentralIcon
                          name="info-simple"
                          className="size-3 text-muted-foreground/60"
                          aria-label="Where the automation runs: a worktree, a local checkout, or auto"
                        />
                      </>
                    }
                  >
                    <span ref={worktreeAnchorRef} className="flex min-w-0 items-center">
                      <InlineSelect
                        value={definition.worktreeMode}
                        options={WORKTREE_OPTIONS}
                        disabled={!editable}
                        title={editDisabledTitle}
                        onChange={(value) => requestWorktreeChange(value as AutomationWorktreeMode)}
                      />
                    </span>
                  </EditRow>
                )}
                {!canChooseEnvironment ? (
                  <DetailRow label="Project">{project?.name ?? "Unknown project"}</DetailRow>
                ) : (
                  <EditRow label="Project">
                    <InlineSelect
                      value={definition.projectId}
                      options={projects.map((entry) => ({ value: entry.id, label: entry.name }))}
                      disabled={!editable}
                      title={editDisabledTitle}
                      onChange={(value) =>
                        patch({ projectId: value as AutomationDefinition["projectId"] })
                      }
                    />
                  </EditRow>
                )}
                {definition.sourceThreadId ? (
                  <DetailRow label="Created from">
                    {sourceThread ? (
                      <button
                        type="button"
                        onClick={() =>
                          void navigate({
                            to: "/$threadId",
                            params: { threadId: sourceThread.id },
                          })
                        }
                        className="min-w-0 truncate text-right text-foreground transition-colors hover:text-primary"
                      >
                        {resolveThreadPickerTitle(sourceThread.title)}
                      </button>
                    ) : (
                      "Thread unavailable"
                    )}
                  </DetailRow>
                ) : null}
                <EditRow label="Repeats">
                  <InlineSelect
                    value={scheduleKindFromSchedule(schedule)}
                    options={SCHEDULE_KIND_OPTIONS}
                    disabled={!editable}
                    title={editDisabledTitle}
                    onChange={(value) =>
                      patch({
                        schedule: scheduleFromKind(
                          value as (typeof SCHEDULE_KIND_OPTIONS)[number]["value"],
                          schedule,
                        ),
                      })
                    }
                  />
                </EditRow>
                {schedule.type === "interval" && schedule.everySeconds !== 3600 ? (
                  <EditRow label="Every">
                    <InlineSelect
                      value={String(schedule.everySeconds)}
                      options={automationIntervalPresetOptions({
                        currentSeconds: schedule.everySeconds,
                        includeHourly: true,
                      })}
                      disabled={!editable}
                      title={editDisabledTitle}
                      onChange={(value) =>
                        patch({
                          schedule: {
                            type: "interval",
                            everySeconds: Number.parseInt(value, 10),
                          },
                        })
                      }
                    />
                  </EditRow>
                ) : null}
                {schedule.type === "once" ? (
                  <EditRow label="Run at">
                    <input
                      type="datetime-local"
                      value={datetimeLocalFromIso(schedule.runAt)}
                      disabled={!editable}
                      title={editDisabledTitle}
                      onChange={(event) =>
                        event.target.value
                          ? patch({
                              schedule: {
                                type: "once",
                                runAt: isoFromDatetimeLocal(event.target.value),
                              },
                            })
                          : undefined
                      }
                      className={INLINE_CONTROL_CLASS}
                    />
                  </EditRow>
                ) : null}
                {schedule.type === "cron" ? (
                  <EditRow label="Cron">
                    <InlineCommitTextInput
                      value={schedule.expression}
                      validate={automationCronExpressionError}
                      normalize={trimDraft}
                      flushOnUnmount={false}
                      disabled={!editable}
                      title={editDisabledTitle}
                      onCommit={(value) =>
                        patch({
                          schedule: {
                            type: "cron",
                            expression: value,
                            timezone: schedule.timezone,
                          },
                        })
                      }
                      className="font-mono"
                    />
                  </EditRow>
                ) : null}
                {schedule.type === "daily" || schedule.type === "weekdays" ? (
                  <EditRow label="Time">
                    <InlineTime
                      value={schedule.timeOfDay}
                      disabled={!editable}
                      title={editDisabledTitle}
                      onChange={(value) =>
                        value ? patch({ schedule: { ...schedule, timeOfDay: value } }) : undefined
                      }
                    />
                  </EditRow>
                ) : null}
                {schedule.type === "weekly" ? (
                  <>
                    <EditRow label="Day">
                      <InlineSelect
                        value={String(schedule.dayOfWeek)}
                        options={[0, 1, 2, 3, 4, 5, 6].map((day) => ({
                          value: String(day),
                          label: weekdayLabel(day),
                        }))}
                        disabled={!editable}
                        title={editDisabledTitle}
                        onChange={(value) =>
                          patch({
                            schedule: updateWeeklyScheduleDay(schedule, Number.parseInt(value, 10)),
                          })
                        }
                      />
                    </EditRow>
                    <EditRow label="Time">
                      <InlineTime
                        value={schedule.timeOfDay}
                        disabled={!editable}
                        title={editDisabledTitle}
                        onChange={(value) =>
                          value
                            ? patch({
                                schedule: updateWeeklyScheduleTime(schedule, value),
                              })
                            : undefined
                        }
                      />
                    </EditRow>
                  </>
                ) : null}
                {(schedule.type === "daily" ||
                  schedule.type === "weekdays" ||
                  schedule.type === "weekly" ||
                  schedule.type === "cron") &&
                schedule.timezone ? (
                  <EditRow label="Timezone">
                    <InlineCommitTextInput
                      value={schedule.timezone}
                      validate={automationTimezoneError}
                      normalize={trimDraft}
                      flushOnUnmount={false}
                      disabled={!editable}
                      title={editDisabledTitle}
                      onCommit={(value) => patch({ schedule: { ...schedule, timezone: value } })}
                    />
                  </EditRow>
                ) : null}
                <EditRow label="Model">
                  <AutomationModelPicker
                    value={definition.modelSelection}
                    projectCwd={project?.cwd ?? null}
                    disabled={!editable}
                    onChange={applyModelSelection}
                  />
                </EditRow>
                <ModelOptionRows
                  modelSelection={definition.modelSelection}
                  disabled={!editable}
                  disabledTitle={editDisabledTitle}
                  onChange={applyModelSelection}
                />
                <EditRow label="Mode">
                  <span ref={modeAnchorRef} className="flex min-w-0 items-center">
                    <InlineSelect
                      value={definition.mode}
                      options={[
                        { value: "standalone", label: MODE_LABELS.standalone },
                        { value: "dedicated", label: MODE_LABELS.dedicated },
                        {
                          value: "heartbeat",
                          label: MODE_LABELS.heartbeat,
                          disabled: projectThreads.length === 0,
                          title:
                            projectThreads.length === 0 ? "No threads in this project" : undefined,
                        },
                      ]}
                      disabled={!editable}
                      title={editDisabledTitle}
                      onChange={(value) => requestModeChange(value as AutomationDefinition["mode"])}
                    />
                  </span>
                </EditRow>
                <EditRow label="Notify">
                  <InlineSelect
                    value={definition.notificationPolicy ?? "all"}
                    options={[
                      { value: "all", label: "All runs" },
                      { value: "failed-runs-only", label: "Failed runs only" },
                    ]}
                    disabled={!editable}
                    title={editDisabledTitle}
                    onChange={(value) =>
                      patch({
                        notificationPolicy:
                          value === "failed-runs-only" ? "failed-runs-only" : "all",
                      })
                    }
                  />
                </EditRow>
                <EditRow label="Stop when">
                  <InlineCommitTextInput
                    value={stopWhen}
                    placeholder="Never"
                    disabled={!editable}
                    title={editDisabledTitle}
                    onCommit={(value) =>
                      patch({
                        completionPolicy: completionPolicyFromStopWhen(value),
                      })
                    }
                  />
                </EditRow>
                <EditRow label="On failure">
                  <InlineSelect
                    value={automationFailurePolicyValue(definition.stopAfterConsecutiveFailures)}
                    options={automationFailurePolicyOptions(
                      automationFailurePolicyValue(definition.stopAfterConsecutiveFailures),
                    )}
                    disabled={!editable}
                    title={editDisabledTitle}
                    onChange={(value) =>
                      patch({
                        stopAfterConsecutiveFailures:
                          stopAfterConsecutiveFailuresFromPolicyValue(value),
                      })
                    }
                  />
                </EditRow>
                <EditRow label="Max iterations">
                  <InlineSelect
                    value={definition.maxIterations == null ? "" : String(definition.maxIterations)}
                    options={maxIterationOptions(definition.maxIterations)}
                    disabled={!editable}
                    title={editDisabledTitle}
                    onChange={(value) =>
                      patch({ maxIterations: value === "" ? null : Number.parseInt(value, 10) })
                    }
                  />
                </EditRow>
                {definition.mode === "heartbeat" ? (
                  <EditRow label="Thread">
                    <div className="flex min-w-0 items-center">
                      {continuedThread ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          className="h-5 shrink-0 px-1.5 text-ui-xs text-muted-foreground/70"
                          onClick={() =>
                            void navigate({
                              to: "/$threadId",
                              params: { threadId: continuedThread.id },
                            })
                          }
                        >
                          Open
                        </Button>
                      ) : null}
                      <InlineSelect
                        value={definition.targetThreadId ?? ""}
                        options={projectThreads.map((thread) => ({
                          value: thread.id,
                          label: resolveThreadPickerTitle(thread.title),
                        }))}
                        disabled={!editable}
                        title={editDisabledTitle}
                        onChange={(value) => patch({ targetThreadId: value as ThreadId })}
                      />
                    </div>
                  </EditRow>
                ) : continuationThreadId !== null ? (
                  <DetailRow label="Thread">
                    {continuedThread ? (
                      <button
                        type="button"
                        onClick={() =>
                          void navigate({
                            to: "/$threadId",
                            params: { threadId: continuedThread.id },
                          })
                        }
                        className="min-w-0 truncate text-right text-foreground transition-colors hover:text-primary"
                      >
                        {resolveThreadPickerTitle(continuedThread.title)}
                      </button>
                    ) : (
                      "Thread unavailable"
                    )}
                  </DetailRow>
                ) : null}
              </DetailGroup>

              <DetailGroup title="Memory">
                <div className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-foreground/[0.035] px-2.5 py-2 font-mono text-ui-sm leading-relaxed text-muted-foreground">
                  {memory?.content || "No persistent memory yet."}
                </div>
              </DetailGroup>

              <DetailGroup title="Previous runs">
                {runs.length === 0 ? (
                  <div className="px-1.5 py-1 text-ui leading-snug text-muted-foreground">
                    No runs yet.
                  </div>
                ) : (
                  <div className="flex flex-col gap-0.5">
                    {runs.map((run) => (
                      <RunRow
                        key={run.id}
                        run={run}
                        onOpen={(threadId) =>
                          void navigate({ to: "/$threadId", params: { threadId } })
                        }
                        onCancel={() => cancelRunMutation.mutate(run)}
                        onMarkRead={(unread) => markRunReadMutation.mutate({ run, unread })}
                        onArchive={(archived) => archiveRunMutation.mutate({ run, archived })}
                      />
                    ))}
                  </div>
                )}
              </DetailGroup>
            </div>
          </div>
        </div>
      </div>

      <AutomationRiskConfirmPopover
        open={pendingWorktreeChange !== null}
        onOpenChange={(open) => {
          if (!open) setPendingWorktreeChange(null);
        }}
        anchor={worktreeAnchorRef}
        title={pendingWorktreeWarning?.title ?? "Local checkout"}
        detail={
          pendingWorktreeWarning?.detail ?? "Runs may edit files in the active project checkout."
        }
        confirmLabel={
          pendingWorktreeChange ? `Switch to ${worktreeModeLabel(pendingWorktreeChange)}` : "Switch"
        }
        onConfirm={confirmWorktreeChange}
      />
      <AutomationRiskConfirmPopover
        open={pendingModeChange !== null}
        onOpenChange={(open) => {
          if (!open) setPendingModeChange(null);
        }}
        anchor={modeAnchorRef}
        title={
          pendingModeChange?.mode === "heartbeat"
            ? "Continue an existing thread"
            : "Release the current thread?"
        }
        detail={
          pendingModeChange?.mode === "heartbeat"
            ? "Each run appends a turn to the thread you pick and waits for it to go idle."
            : `The automation stops writing to ${
                continuedThreadTitle ? `“${continuedThreadTitle}”` : "its thread"
              }; the thread itself is kept.`
        }
        confirmLabel={
          pendingModeChange ? `Switch to ${MODE_LABELS[pendingModeChange.mode]}` : "Switch"
        }
        confirmDisabled={
          pendingModeChange?.mode === "heartbeat" && pendingModeChange.targetThreadId === ""
        }
        onConfirm={confirmModeChange}
      >
        {pendingModeChange?.mode === "heartbeat" ? (
          <div className="relative flex items-center">
            <select
              value={pendingModeChange.targetThreadId}
              aria-label="Target thread"
              onChange={(event) =>
                setPendingModeChange({ mode: "heartbeat", targetThreadId: event.target.value })
              }
              className="w-full appearance-none rounded-md border border-border bg-transparent px-2 py-1.5 pr-6 text-ui leading-snug outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {pendingModeChange.targetThreadId === "" ? (
                <option value="">Pick a thread…</option>
              ) : null}
              {projectThreads.map((thread) => (
                <option key={thread.id} value={thread.id}>
                  {resolveThreadPickerTitle(thread.title)}
                </option>
              ))}
            </select>
            <CentralIcon
              name="chevron-down-small"
              className="pointer-events-none absolute right-2 size-3 text-muted-foreground"
            />
          </div>
        ) : null}
      </AutomationRiskConfirmPopover>
    </RouteInsetSurface>
  );
}
