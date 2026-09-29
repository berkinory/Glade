import type { AutomationDefinition, AutomationSchedule } from "@glade/contracts";

export type AutomationLifecycleState = "active" | "paused" | "scheduled" | "done";

function isOneTimeSchedule(schedule: AutomationSchedule): boolean {
  return schedule.type === "once";
}

export function canPauseAutomation(definition: Pick<AutomationDefinition, "schedule">): boolean {
  return !isOneTimeSchedule(definition.schedule);
}

export function automationLifecycleState(
  definition: Pick<AutomationDefinition, "schedule" | "enabled" | "nextRunAt">,
): AutomationLifecycleState {
  if (isOneTimeSchedule(definition.schedule)) {
    return definition.enabled && definition.nextRunAt ? "scheduled" : "done";
  }
  return definition.enabled ? "active" : "paused";
}
