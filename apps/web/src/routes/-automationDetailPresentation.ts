import type { AutomationDefinition, AutomationRun } from "@glade/contracts/automation/automation";
import { automationLifecycleState } from "~/lib/automationStatus";

export const trimDraft = (value: string) => value.trim();

export function lastFinishedRun(runs: readonly AutomationRun[]): AutomationRun | null {
  return runs.find((run) => run.finishedAt != null || run.startedAt != null) ?? null;
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

const RUN_TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
});
const RUN_DATE_TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatRunTimestamp(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const time = RUN_TIME_FORMATTER.format(date);
  const dayDelta = Math.round((startOfDay(date) - startOfDay(new Date())) / 86_400_000);
  if (dayDelta === 0) return `Today at ${time}`;
  if (dayDelta === 1) return `Tomorrow at ${time}`;
  if (dayDelta === -1) return `Yesterday at ${time}`;
  return RUN_DATE_TIME_FORMATTER.format(date);
}

export function automationStatusDisplay(definition: AutomationDefinition): {
  readonly label: string;
  readonly dotClassName: string;
} {
  switch (automationLifecycleState(definition)) {
    case "active":
      return { label: "Active", dotClassName: "bg-emerald-500" };
    case "paused":
      return { label: "Paused", dotClassName: "bg-amber-500" };
    case "scheduled":
      return { label: "Scheduled", dotClassName: "bg-sky-500" };
    case "done":
      return { label: "Done", dotClassName: "bg-muted-foreground" };
  }
}

export function automationStoppedExplanation(definition: AutomationDefinition): string | null {
  if (definition.enabled || definition.disabledReason == null) return null;
  switch (definition.disabledReason) {
    case "failures":
      return definition.consecutiveFailureCount === 1
        ? "Stopped after a failed run."
        : `Stopped after ${definition.consecutiveFailureCount} consecutive failed runs.`;
    case "max-iterations":
      return "Stopped at its run limit.";
    case "completion":
      return "Stopped because its stop condition was met.";
    case "schedule":
    case "user":
      return null;
  }
}
