import type { AutomationMode, ThreadCreationSource, ThreadId } from "@glade/contracts";

export function automationContinuesThread(mode: AutomationMode): boolean {
  return mode === "heartbeat" || mode === "dedicated";
}

export function automationOwnsItsThread(mode: AutomationMode): boolean {
  return mode === "dedicated";
}

export function automationRequiresTargetThread(mode: AutomationMode): boolean {
  return mode === "heartbeat";
}

export function automationContinuationThreadId(definition: {
  readonly mode: AutomationMode;
  readonly targetThreadId: ThreadId | null;
}): ThreadId | null {
  return automationContinuesThread(definition.mode) ? definition.targetThreadId : null;
}

// Dedicated/heartbeat continuation threads are never marked (see the ThreadCreationSource
// contract), so this stays false for them.
export function isAutomationRunThread(thread: {
  readonly creationSource?: ThreadCreationSource | null;
}): boolean {
  return thread.creationSource === "automation_run";
}
