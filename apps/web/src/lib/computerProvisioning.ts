import type {
  ComputerPermission,
  ComputerProvisionResult,
} from "@glade/contracts/computer/computer";
import type {
  DesktopComputerPermissionKind,
  DesktopComputerState,
  DesktopBridge,
} from "@glade/contracts/ipc/ipc";
import {
  COMPUTER_PERMISSIONS,
  listComputerPermissions,
  missingComputerPermissions,
} from "@glade/shared/computer/computerGrants";

import { computerStatusNeedsSetup } from "~/components/ComputerPanel.logic";
import { isLoopbackHostname } from "../components/Sidebar.logic.statusTypes";

export function readLocalComputerPermissionBridge(): DesktopBridge["computerPermissions"] | null {
  if (globalThis.window?.nativeApi) return null;
  const bridge = globalThis.window?.desktopBridge;
  if (!bridge?.computerPermissions) return null;
  try {
    const endpoint = bridge.getWsUrl?.();
    if (!endpoint) return null;
    const url = new URL(endpoint);
    return (url.protocol === "ws:" || url.protocol === "wss:") && isLoopbackHostname(url.hostname)
      ? bridge.computerPermissions
      : null;
  } catch {
    return null;
  }
}

export function computerPermissionSetupSupported(state: DesktopComputerState | null): boolean {
  return state?.supported === true && state.platform === "macos";
}

export async function prepareComputerPermissionGuide(input: {
  readonly getPermissionState?: (
    permissions: readonly DesktopComputerPermissionKind[],
  ) => Promise<DesktopComputerState>;
  readonly startPermissionSetup?: (
    permissions: readonly DesktopComputerPermissionKind[],
  ) => Promise<unknown>;
  readonly isCurrent: () => boolean;
}): Promise<boolean> {
  if (!input.getPermissionState || !input.startPermissionSetup) return input.isCurrent();
  if (!input.isCurrent()) return false;
  const state = await input.getPermissionState(COMPUTER_PERMISSIONS);
  if (!input.isCurrent()) return false;
  if (!computerPermissionSetupSupported(state)) return true;
  if (missingComputerPermissions(state).length === 0) return true;
  await input.startPermissionSetup(COMPUTER_PERMISSIONS);
  return false;
}

export type ComputerProvisionOutcome = "ready" | "incomplete";

export function computerProvisionOutcome(
  result: ComputerProvisionResult,
): ComputerProvisionOutcome {
  return result.status.availability.kind === "available" &&
    result.status.health.status === "connected" &&
    !computerStatusNeedsSetup(result.status)
    ? "ready"
    : "incomplete";
}

export interface ComputerProvisionToast {
  readonly type: "info" | "success" | "warning" | "error";
  readonly title: string;
  readonly description: string;
}

// Raised as the call starts, because the call's visible effect is a macOS dialog appearing over
// Glade and the user needs to know Glade asked for it. The grants are named through
// `listComputerPermissions` rather than written out, so this cannot drift out of the one fixed
// ordering every other surface uses — a hand-written "Screen Recording and Accessibility" here
// against "Accessibility and Screen Recording" in the card is exactly the divergence that module
// exists to prevent.
export function computerProvisionStartToast(
  missing: readonly ComputerPermission[] = [],
): ComputerProvisionToast {
  const labels = listComputerPermissions(missing);
  return {
    type: "info",
    title: "Setting up computer control",
    description:
      labels.length > 0
        ? `macOS may ask to allow ${labels} for Glade.`
        : "Setting up the desktop may require installing a helper or allowing the permissions Glade needs.",
  };
}

export function computerProvisionResultToast(
  result: ComputerProvisionResult,
): ComputerProvisionToast {
  return computerProvisionOutcome(result) === "ready"
    ? { type: "success", title: "Computer control is ready", description: result.summary }
    : {
        type: "warning",
        title: "Computer control still needs setup",
        description: result.summary,
      };
}

export function computerProvisionErrorToast(error: unknown): ComputerProvisionToast {
  return {
    type: "error",
    title: "Couldn't set up computer control",
    description: provisionErrorMessage(error),
  };
}

function provisionErrorMessage(error: unknown): string {
  return error instanceof Error && error.message.length > 0
    ? error.message
    : "The server gave no reason.";
}

export function computerProvisionNote(state: {
  readonly isPending: boolean;
  readonly missing?: readonly ComputerPermission[];
  readonly error?: unknown;
  readonly result?: ComputerProvisionResult | undefined;
}): string | undefined {
  if (state.isPending) {
    if (state.missing?.length) {
      return `Checking ${listComputerPermissions(state.missing)}. Allow access in the macOS prompt or System Settings, then return to Glade.`;
    }
    return (
      "Setting up the agent's desktop. This installs or builds whatever this machine still needs, " +
      "and may ask for your password or for desktop permissions. The first run can take a few minutes."
    );
  }
  if (state.error !== undefined && state.error !== null) {
    return `Setting up failed. ${provisionErrorMessage(state.error)}`;
  }
  return state.result?.summary;
}
