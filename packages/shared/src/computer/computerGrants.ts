import type {
  ComputerBuildSignature,
  ComputerPermission,
} from "@glade/contracts/computer/computer";
import type { DesktopComputerState } from "@glade/contracts/ipc/ipc";

export const COMPUTER_PERMISSIONS: readonly ComputerPermission[] = [
  "accessibility",
  "screenRecording",
  "inputMonitoring",
];

export function missingComputerPermissions(
  state: Pick<
    DesktopComputerState,
    "accessibilityPermission" | "screenRecordingPermission" | "inputMonitoringPermission"
  >,
): readonly ComputerPermission[] {
  const grants = {
    accessibility: state.accessibilityPermission,
    screenRecording: state.screenRecordingPermission,
    inputMonitoring: state.inputMonitoringPermission,
  };
  return COMPUTER_PERMISSIONS.filter((permission) => grants[permission] !== "granted");
}

// The grants without which the desktop cannot be driven at all.
export const COMPUTER_BLOCKING_PERMISSIONS: readonly ComputerPermission[] = [
  "accessibility",
  "inputMonitoring",
];

export function computerGrantsBlockControl(permissions: readonly ComputerPermission[]): boolean {
  return COMPUTER_BLOCKING_PERMISSIONS.some((permission) => permissions.includes(permission));
}

// Exactly what System Settings › Privacy & Security calls each grant.
export const COMPUTER_PERMISSION_LABELS: Readonly<Record<ComputerPermission, string>> = {
  accessibility: "Accessibility",
  screenRecording: "Screen Recording",
  inputMonitoring: "Input Monitoring",
};

// Exported because the macOS backend resets the app's own stale ad-hoc rows before asking for a
// grant, and it has to name the services the same way this copy does — two spellings of
// `ScreenCapture` is exactly the class of bug this module exists to prevent.
export const TCC_SERVICE_NAMES: Readonly<Record<ComputerPermission, string>> = {
  accessibility: "Accessibility",
  screenRecording: "ScreenCapture",
  inputMonitoring: "ListenEvent",
};

export function sortComputerPermissions(
  permissions: readonly ComputerPermission[],
): readonly ComputerPermission[] {
  return COMPUTER_PERMISSIONS.filter((permission) => permissions.includes(permission));
}

export function listComputerPermissions(permissions: readonly ComputerPermission[]): string {
  const labels = sortComputerPermissions(permissions).map(
    (permission) => COMPUTER_PERMISSION_LABELS[permission],
  );
  if (labels.length === 0) return "";
  if (labels.length === 1) return labels[0]!;
  return `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
}

// What to tell a user whose System Settings already shows Glade switched on while the helper still
// reports the grant missing — or null when that cannot be what happened. macOS pins an ad-hoc
// signature's grant to the binary's cdhash, so a local rebuild invalidates it without changing
// anything the user can see. A Developer ID signature keys on identifier plus team and survives
// rebuilds, so this advice would be a red herring on a release build and is withheld there. The
// user can remove and re-add this specific build in System Settings, or reset its own bundle
// explicitly when the responsible identity is known. `bundleId` is the *responsible* app's
// identifier — the Glade the grant is actually filed against, which `.dev` and `.canary` builds do
// not share with a released one. It is optional because nothing can derive it: a server started
// outside the desktop shell has no app behind it, and the desktop tells the backend which flavor it
// is through `GLADE_DESKTOP_BUNDLE_ID_ENV`. When it is unknown the whole `tccutil` sentence is
// withheld rather than printed with a guess, because the guess a user would paste into Terminal
// resets a *different* Glade's grants — the one they have installed — and leaves this one exactly
// as broken as before.
export function computerStaleGrantAdvice(
  permissions: readonly ComputerPermission[],
  buildSignature: ComputerBuildSignature,
  bundleId?: string | undefined,
): string | null {
  if (buildSignature !== "adhoc") return null;
  const sorted = sortComputerPermissions(permissions);
  if (sorted.length === 0) return null;
  const base =
    "This is a locally built copy of Glade, so macOS may already list it with the switch on from " +
    "an earlier build. Remove this app from the permission list, add the current build again, " +
    "then fully quit and reopen it.";
  const responsibleBundleId = bundleId?.trim();
  if (!responsibleBundleId) return base;
  const commands = sorted
    .map((permission) => `tccutil reset ${TCC_SERVICE_NAMES[permission]} ${responsibleBundleId}`)
    .join(", then ");
  return `${base} To clear only this app's old grant, run \`${commands}\` in Terminal and grant access again.`;
}

export function computerPermissionSetupMessage(
  permissions: readonly ComputerPermission[],
  buildSignature: ComputerBuildSignature,
  bundleId?: string | undefined,
): string {
  const labels = listComputerPermissions(permissions);
  const base =
    labels.length > 0
      ? `Glade needs ${labels} to control this Mac. Turn Glade on in System Settings › Privacy & Security › ${labels}, then try again.`
      : "Glade needs a macOS privacy permission to control this Mac. Grant it in System Settings › Privacy & Security, then try again.";
  const advice = computerStaleGrantAdvice(permissions, buildSignature, bundleId);
  return advice ? `${base} ${advice}` : base;
}
