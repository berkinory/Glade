import {
  COMPUTER_MAC_BACKEND,
  COMPUTER_NESTED_KWIN_BACKEND,
  type ComputerActionEvent,
  type ComputerAvailability,
  type ComputerFrameHeader,
  type ComputerHealth,
  type ComputerStatusResult,
  type ComputerWindow,
  type ThreadComputerState,
} from "@glade/contracts/computer/computer";
import { listComputerPermissions } from "@glade/shared/computer/computerGrants";
import { COMPUTER_TOOL_TITLES, computerToolName } from "../lib/computerToolPresentation";

export interface ComputerFrameGateState {
  readonly lastSequence: number | null;
}

type ComputerFrameGateAction = "ignore" | "drop-stale" | "decode";

export interface ComputerFrameGateStep {
  readonly state: ComputerFrameGateState;
  readonly action: ComputerFrameGateAction;
  readonly requestResync: boolean;
}

const UINT32_MODULUS = 0x1_0000_0000;
const UINT32_HALF_RANGE = 0x8000_0000;

export function createComputerFrameGateState(): ComputerFrameGateState {
  return { lastSequence: null };
}

export function stepComputerFrameGate(
  state: ComputerFrameGateState,
  header: Pick<ComputerFrameHeader, "computerId" | "sequence">,
  expectedComputerId: string,
): ComputerFrameGateStep {
  if (header.computerId !== expectedComputerId) {
    return { state, action: "ignore", requestResync: false };
  }

  if (state.lastSequence === null) {
    return { state: { lastSequence: header.sequence }, action: "decode", requestResync: false };
  }

  const distance = (header.sequence - state.lastSequence + UINT32_MODULUS) % UINT32_MODULUS;
  if (distance === 0 || distance >= UINT32_HALF_RANGE) {
    return { state, action: "drop-stale", requestResync: false };
  }

  return {
    state: { lastSequence: header.sequence },
    action: "decode",
    requestResync: distance > 1,
  };
}

function computerBackendIsIdle(health: ComputerHealth | undefined): boolean {
  return (
    health?.status === "unavailable" &&
    health.consecutiveFailures === 0 &&
    health.lastFailure === undefined
  );
}

export type ComputerAvailabilityView =
  | { readonly kind: "checking"; readonly title: string; readonly description: string }
  | { readonly kind: "ready"; readonly title: string; readonly description: string }
  | {
      readonly kind: "blocked";
      readonly title: string;
      readonly description: string;
    };

export function resolveComputerAvailabilityView(
  availability: ComputerAvailability | undefined,
  health?: ComputerHealth,
  grantsConfirmed = false,
): ComputerAvailabilityView {
  // A pending retry is not a dead desktop, and the viewport must not say it is: the frames stop
  // either way, but one of the two states ends by itself.
  if (health?.status === "reconnecting") {
    return {
      kind: "checking",
      title: "Reconnecting to the desktop",
      description: health.lastFailure ? health.lastFailure.message : COMPUTER_RECONNECTING_NOTE,
    };
  }
  if (!availability) {
    return {
      kind: "checking",
      title: "Checking computer availability",
      description: "Waiting for the desktop backend.",
    };
  }
  if (availability.kind === "available") {
    if (grantsConfirmed && computerBackendIsIdle(health)) {
      return {
        kind: "ready",
        title: "All permissions granted",
        description: "Glade connects to the desktop the next time an agent uses it.",
      };
    }
    if (health && health.status !== "connected") {
      return {
        kind: "checking",
        title: "Computer access has not been checked",
        description: "Choose Set up to check that Glade can see and control the desktop.",
      };
    }
    if (health?.captureAvailable === false) {
      return {
        kind: "blocked",
        title: "Screen capture is unavailable",
        description:
          "Desktop input is connected, but Glade cannot take screenshots. Choose Set up to check access.",
      };
    }
    return {
      kind: "ready",
      title: "Connected to the desktop",
      description: "Glade can see and control the desktop through its computer tools.",
    };
  }
  if (availability.kind === "unsupported-platform") {
    return {
      kind: "blocked",
      title: "Computer control is unavailable",
      description: `This server is running on ${availability.platform}. Computer control needs macOS, or a Wayland desktop on Linux — KWin or Hyprland, or Glade's own nested desktop.`,
    };
  }

  if (availability.kind === "permission-required") {
    return {
      kind: "blocked",
      title: `Computer control needs ${listComputerPermissions(availability.missing)}`,
      description: availability.message,
    };
  }
  return {
    kind: "blocked",
    title: "Computer control is unavailable",
    description: availability.message,
  };
}

// Setup depends on live availability, not static capabilities: a backend may advertise input and
// capture before either grant exists. Chat setup and settings must answer the same readiness
// question.
export type ComputerSetupProbe = Pick<
  ComputerStatusResult,
  "availability" | "health" | "capabilities" | "provisionable"
>;

export function computerStatusNeedsSetup(
  status: ComputerSetupProbe | undefined,
  grantsConfirmed = false,
): boolean {
  if (!status) return false;
  if (status.availability.kind === "unsupported-platform") return false;

  const idle = grantsConfirmed && computerBackendIsIdle(status.health);
  return (
    (status.provisionable === true && status.health.status !== "connected" && !idle) ||
    status.availability.kind === "backend-unavailable" ||
    status.availability.kind === "permission-required" ||
    (status.health.captureAvailable === false && !idle) ||
    !status.capabilities.input ||
    !status.capabilities.capture
  );
}

const COMPUTER_RECONNECTING_NOTE = "The desktop backend dropped out and is being reconnected.";

export function computerReconnectsNote(health: ComputerHealth | undefined): string | null {
  const reconnects = health?.reconnects ?? 0;
  if (reconnects <= 0) return null;
  return `Reconnected ${reconnects === 1 ? "once" : `${reconnects} times`} since startup.`;
}

export function computerCanvasLabel(input: {
  readonly availability: ComputerAvailability | undefined;
  readonly visibleDesktop: boolean;
}): string {
  const backend = input.availability?.kind === "available" ? input.availability.backend : undefined;
  if (backend === COMPUTER_MAC_BACKEND) return "This Mac's desktop";
  if (backend === COMPUTER_NESTED_KWIN_BACKEND) return "The agent's own desktop";
  if (input.visibleDesktop) return "This computer's desktop";
  return "The agent's desktop";
}

// The backend's `action` is a tool-shaped identifier (`computer_click`, `type_text`) and the pane
// is not a log viewer, so it is spoken rather than printed. A failure keeps its message, because
// that is the only part of a failed action worth the space.
function computerActionLabel(
  action: Pick<ComputerActionEvent, "action" | "ok" | "message"> | undefined,
): string | null {
  if (!action) return null;
  const tool = computerToolName(action.action);
  const fallback = action.action
    .replace(/^computer[_.]/, "")
    .replace(/[_.]+/g, " ")
    .trim();
  if (!tool && fallback.length === 0) return null;
  const label = tool
    ? COMPUTER_TOOL_TITLES[tool]
    : `${fallback[0]!.toUpperCase()}${fallback.slice(1)}`;
  if (action.ok) return label;
  return action.message ? `${label} failed: ${action.message}` : `${label} failed`;
}

export function shouldSubscribeToComputerStream(input: {
  readonly runtimeMode: "live" | "preview";
  readonly isVisible: boolean;
  readonly threadState: ThreadComputerState | undefined;
}): boolean {
  return (
    input.runtimeMode === "live" &&
    input.isVisible &&
    input.threadState?.availability.kind === "available"
  );
}

export function computerActionStatusLabel(
  action: ComputerActionEvent | undefined,
  windows: readonly ComputerWindow[] | undefined,
): string | null {
  const label = computerActionLabel(action);
  if (!label) return null;
  const app = windows?.find((window) => window.id === action?.windowId)?.appName;
  const path = action?.delivery?.path;
  const delivery = path
    ? path.includes("foreground")
      ? "Temporary foreground"
      : "Background action"
    : undefined;
  return [label, app, delivery].filter(Boolean).join(" · ");
}
