import type { ProviderKind, ServerProviderStatus } from "@glade/contracts";

export const ONBOARDING_STEPS = [
  "welcome",
  "tour",
  "providers",
  "theme",
  "project",
  "done",
] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export function nextOnboardingStep(step: OnboardingStep): OnboardingStep {
  const index = ONBOARDING_STEPS.indexOf(step);
  return ONBOARDING_STEPS[Math.min(index + 1, ONBOARDING_STEPS.length - 1)] ?? "done";
}

export function previousOnboardingStep(step: OnboardingStep): OnboardingStep {
  const index = ONBOARDING_STEPS.indexOf(step);
  return ONBOARDING_STEPS[Math.max(index - 1, 0)] ?? "welcome";
}

// Steps where the user has started making setup choices; the tour must not auto-close past here.
export function isOnboardingSetupStep(step: OnboardingStep): boolean {
  return step !== "welcome" && step !== "tour";
}

export interface LocalOnboardingCompletion {
  readonly completedAt: string | null;
  // Identity of the server installation the completion was recorded against (its worktrees
  // directory). A browser origin can be pointed at a different server state or home directory later;
  // a marker from another installation must not hide its tour.
  readonly installationKey: string | null;
}

export function resolveLocalOnboardingCompletion(
  local: LocalOnboardingCompletion,
  currentInstallationKey: string | null,
): string | null {
  if (local.completedAt === null) return null;
  if (currentInstallationKey === null || local.installationKey === null) {
    return null;
  }
  return local.installationKey === currentInstallationKey ? local.completedAt : null;
}

export type OnboardingGate = "pending" | "show" | "hidden";

export interface OnboardingGateInputs {
  readonly installationKeyStatus: "pending" | "success" | "error";

  readonly threadsHydrated: boolean;

  readonly settingsSettled: boolean;

  readonly projectCount: number;
  readonly serverCompletedAt: string | null;

  readonly localCompletedAt: string | null;
}

export function resolveOnboardingGate(input: OnboardingGateInputs): OnboardingGate {
  if (
    input.installationKeyStatus === "pending" ||
    !input.threadsHydrated ||
    !input.settingsSettled
  ) {
    return "pending";
  }
  if (input.installationKeyStatus === "error") return "hidden";
  const completed = input.serverCompletedAt !== null || input.localCompletedAt !== null;
  return !completed && input.projectCount === 0 ? "show" : "hidden";
}

export interface OnboardingReconcileInputs {
  readonly threadsHydrated: boolean;

  readonly settingsAvailable: boolean;
  readonly projectCount: number;
  readonly serverCompletedAt: string | null;
  readonly localCompletedAt: string | null;

  readonly now: string;
}

// Two cases need the marker persisted after the fact: - a completion whose server write failed
// (only the local marker exists), and - an installation that predates the tour (projects exist, no
// marker anywhere), which must never see the "first run" tour just because its last project is
// later removed.
export function resolveOnboardingCompletionToReconcile(
  input: OnboardingReconcileInputs,
): string | null {
  if (!input.threadsHydrated || !input.settingsAvailable || input.serverCompletedAt !== null) {
    return null;
  }
  if (input.localCompletedAt !== null) {
    return input.localCompletedAt;
  }
  return input.projectCount > 0 ? input.now : null;
}

export type ProviderSetupState =
  | "connected"
  | "needs-sign-in"
  | "not-installed"
  | "detecting"
  | "check-failed"
  | "disabled";

export function classifyProviderSetup(input: {
  readonly status: Pick<ServerProviderStatus, "available" | "authStatus"> | null | undefined;
  readonly disabled: boolean;
  readonly detecting?: boolean;
  readonly detectionFailed?: boolean;
}): ProviderSetupState {
  if (input.disabled) return "disabled";
  if (!input.status && input.detecting) return "detecting";
  if (!input.status && input.detectionFailed) return "check-failed";
  if (!input.status || !input.status.available) return "not-installed";

  return input.status.authStatus === "unauthenticated" ? "needs-sign-in" : "connected";
}

export interface ProviderSetupSummary {
  readonly enabled: number;
  readonly connected: number;
  readonly needsSignIn: number;
  readonly notInstalled: number;
  readonly detecting: number;
  readonly checkFailed: number;
}

export function summarizeProviderSetup(
  states: ReadonlyArray<{ readonly provider: ProviderKind; readonly state: ProviderSetupState }>,
): ProviderSetupSummary {
  let enabled = 0;
  let connected = 0;
  let needsSignIn = 0;
  let notInstalled = 0;
  let detecting = 0;
  let checkFailed = 0;
  for (const entry of states) {
    if (entry.state !== "disabled") enabled += 1;
    if (entry.state === "connected") connected += 1;
    if (entry.state === "needs-sign-in") needsSignIn += 1;
    if (entry.state === "not-installed") notInstalled += 1;
    if (entry.state === "detecting") detecting += 1;
    if (entry.state === "check-failed") checkFailed += 1;
  }
  return { enabled, connected, needsSignIn, notInstalled, detecting, checkFailed };
}

export function describeOnboardingAgentSummary(summary: ProviderSetupSummary): string {
  if (summary.detecting > 0) return "Checking agents…";
  if (summary.checkFailed > 0) return "Could not check all agents";
  return `${summary.connected} agent${summary.connected === 1 ? "" : "s"} connected`;
}
