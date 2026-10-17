export const ONBOARDING_STEPS = ["welcome", "agents", "permissions", "start"] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export function nextOnboardingStep(step: OnboardingStep): OnboardingStep {
  const index = ONBOARDING_STEPS.indexOf(step);
  return ONBOARDING_STEPS[Math.min(index + 1, ONBOARDING_STEPS.length - 1)] ?? "start";
}

export function previousOnboardingStep(step: OnboardingStep): OnboardingStep {
  const index = ONBOARDING_STEPS.indexOf(step);
  return ONBOARDING_STEPS[Math.max(index - 1, 0)] ?? "welcome";
}

// Past the welcome the user is making choices; the first-run gate must not auto-close from here.
export function isOnboardingSetupStep(step: OnboardingStep): boolean {
  return step !== "welcome";
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
