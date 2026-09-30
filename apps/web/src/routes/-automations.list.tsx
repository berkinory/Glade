import {
  type AutomationCreateInput,
  type AutomationDefinition,
  type AutomationRun,
} from "@glade/contracts/automation/automation";
import { useEffect, useState, type ReactNode } from "react";

import { getProviderStartOptions, useAppSettings } from "~/appSettings";
import {
  hasBlockingAutomationDraftWarnings,
  updateAutomationDraftWarningAcknowledgement,
  type AutomationDraftWarning,
  type AutomationDraftWarningId,
} from "~/lib/automationDraft";
import { automationLifecycleState } from "~/lib/automationStatus";
import { CentralIcon } from "~/lib/central-icons";
import { cn } from "~/lib/utils";
import {
  SIDEBAR_ROW_ACTIVE_CLASS_NAME,
  SIDEBAR_ROW_FOCUS_CLASS_NAME,
  SIDEBAR_ROW_HOVER_CLASS_NAME,
} from "~/sidebarRowStyles";
import { ELEVATED_HOVER_SURFACE_CLASS_NAME } from "~/surfaceStyles";
import { useStore } from "~/store";
import { createSidebarThreadSummariesSelector } from "~/storeSelectors";
import {
  type AutomationFormState,
  AutomationDialog,
  acknowledgedRiskIdsForFormWarnings,
  automationAttentionLabel,
  buildAutomationFormWarnings,
  createInputFromForm,
  formatCadenceLong,
  formatNextRun,
  formFromDefinition,
  isFormSubmittable,
  isLiveRun,
  isRowInteractiveEventTarget,
  isUnresolvedTriageResult,
  projectModelSelection,
  runStatusLabel,
} from "./-automations.shared";

const selectAllThreads = createSidebarThreadSummariesSelector();

export function hasUnreadResult(run: AutomationRun | null): boolean {
  return run?.status === "succeeded" && isUnresolvedTriageResult(run.result);
}

export function AutomationListRow({
  onClick,
  leading,
  title,
  detail,
  meta,
  onDelete,
  dimmed: dimmedProp,
  density: densityProp,
  active: activeProp,
}: {
  readonly onClick: () => void;
  readonly leading: ReactNode;
  readonly title: string;
  readonly detail: string;
  readonly meta?: ReactNode;
  readonly onDelete?: () => void;
  readonly dimmed?: boolean;

  readonly density?: "page" | "panel";

  readonly active?: boolean;
}) {
  const dimmed = dimmedProp ?? false;
  const isPanel = (densityProp ?? "page") === "panel";
  const active = activeProp ?? false;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(event) => {
        if (isRowInteractiveEventTarget(event.target, event.currentTarget)) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      }}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex w-full cursor-pointer items-start rounded-md text-left",
        isPanel
          ? cn(
              "gap-2 px-2 py-1.5",
              SIDEBAR_ROW_FOCUS_CLASS_NAME,
              active ? SIDEBAR_ROW_ACTIVE_CLASS_NAME : SIDEBAR_ROW_HOVER_CLASS_NAME,
            )
          : cn("gap-2.5 px-2 py-2.5", ELEVATED_HOVER_SURFACE_CLASS_NAME),
      )}
    >
      <span className="mt-0.5 flex shrink-0">{leading}</span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          className={cn(
            "truncate",
            isPanel ? "text-ui" : "text-ui-lg",
            dimmed ? "text-muted-foreground" : "text-foreground",
          )}
        >
          {title}
        </span>
        <span
          className={cn(
            "truncate leading-snug",
            isPanel ? "text-ui-sm" : "text-ui",
            dimmed ? "text-muted-foreground/60" : "text-muted-foreground",
          )}
        >
          {detail}
        </span>
      </span>
      {meta == null ? null : (
        <span className="shrink-0 self-center text-ui leading-snug tabular-nums text-muted-foreground">
          {meta}
        </span>
      )}
      {onDelete ? (
        <button
          type="button"
          aria-label="Delete automation"
          title="Delete"
          onClick={(event) => {
            event.stopPropagation();
            onDelete();
          }}
          className="shrink-0 self-center rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
        >
          <CentralIcon name="trash-can-simple" className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}

export function automationRowSubtitle(
  definition: AutomationDefinition,
  latestRun: AutomationRun | null,
  now: number,
): string {
  const segments = [formatCadenceLong(definition.schedule)];
  if (isLiveRun(latestRun)) {
    segments.push(runStatusLabel(latestRun.status));
    return segments.join(" · ");
  }
  const attention = latestRun === null ? null : automationAttentionLabel(latestRun);
  if (definition.enabled) {
    const nextRun = formatNextRun(definition.nextRunAt, now);
    if (nextRun) segments.push(`Next run ${nextRun}`);
  } else {
    const stopped = stoppedReasonLabel(definition);
    if (stopped) {
      segments.push(stopped);
      return segments.join(" · ");
    }
    if (attention === null && automationLifecycleState(definition) === "done") {
      segments.push("Done");
    }
  }
  if (attention) segments.push(attention);
  return segments.join(" · ");
}

function stoppedReasonLabel(definition: AutomationDefinition): string | null {
  switch (definition.disabledReason) {
    case "failures":
      return definition.consecutiveFailureCount === 1
        ? "Stopped after a failed run"
        : `Stopped after ${definition.consecutiveFailureCount} failed runs`;
    case "max-iterations":
      return "Stopped at run limit";
    case "completion":
      return "Stop condition met";
    default:
      return null;
  }
}

export function useAutomationListClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

export function AutomationCreateDialog({
  open,
  onOpenChange,
  createAutomation,
  busy,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly createAutomation: (input: AutomationCreateInput, onCreated: () => void) => void;
  readonly busy: boolean;
}) {
  const { settings } = useAppSettings();
  const projects = useStore((state) => state.projects);
  const threads = useStore(selectAllThreads);
  const fallbackProjectId = projects[0]?.id ?? "";
  const [form, setForm] = useState<AutomationFormState>(() =>
    formFromDefinition(null, fallbackProjectId, projectModelSelection(projects, fallbackProjectId)),
  );
  const [warnings, setWarnings] = useState<readonly AutomationDraftWarning[]>([]);
  const [acknowledgedWarningIds, setAcknowledgedWarningIds] = useState<
    ReadonlySet<AutomationDraftWarningId>
  >(() => new Set());

  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      const nextForm = formFromDefinition(
        null,
        fallbackProjectId,
        projectModelSelection(projects, fallbackProjectId),
      );
      setForm(nextForm);
      setWarnings(buildAutomationFormWarnings(nextForm));
      setAcknowledgedWarningIds(new Set());
    }
  }

  const updateForm = (nextForm: AutomationFormState) => {
    setForm(nextForm);
    setWarnings(buildAutomationFormWarnings(nextForm));
  };

  const toggleWarning = (id: AutomationDraftWarningId, checked: boolean) => {
    setAcknowledgedWarningIds((current) =>
      updateAutomationDraftWarningAcknowledgement(current, id, checked),
    );
  };

  const submit = () => {
    if (!isFormSubmittable(form)) return;
    if (hasBlockingAutomationDraftWarnings(warnings, acknowledgedWarningIds)) return;
    const acknowledgedRisks = acknowledgedRiskIdsForFormWarnings(warnings, acknowledgedWarningIds);
    createAutomation(
      createInputFromForm(form, getProviderStartOptions(settings), acknowledgedRisks),
      () => onOpenChange(false),
    );
  };

  return (
    <AutomationDialog
      open={open}
      form={form}
      projects={projects}
      threads={threads}
      warnings={warnings}
      acknowledgedWarningIds={acknowledgedWarningIds}
      onToggleWarning={toggleWarning}
      onOpenChange={onOpenChange}
      onFormChange={updateForm}
      onSubmit={submit}
      busy={busy}
    />
  );
}
