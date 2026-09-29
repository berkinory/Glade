import type { ThreadComputerState, ThreadId } from "@glade/contracts";

export type ComputerPreviewPhase = "armed" | "live" | "hidden-for-task" | "ended";

export type ComputerPreviewCardSize = "compact" | "large";

export interface ComputerPreviewCardCaps {
  readonly minWidthPx: number;
  readonly maxWidthPx: number;
}

export function computerPreviewCardCaps(size: ComputerPreviewCardSize): ComputerPreviewCardCaps {
  return size === "large"
    ? { minWidthPx: 240, maxWidthPx: 560 }
    : { minWidthPx: 240, maxWidthPx: 400 };
}

const COMPUTER_PREVIEW_FLOAT_MARGIN_PX = 8;

export function clampComputerPreviewFloat(input: {
  readonly x: number;
  readonly y: number;
  readonly cardWidthPx: number;
  readonly cardHeightPx: number;
  readonly viewportWidthPx: number;
  readonly viewportHeightPx: number;
}): { readonly x: number; readonly y: number } {
  const margin = COMPUTER_PREVIEW_FLOAT_MARGIN_PX;
  const maxX = Math.max(margin, input.viewportWidthPx - input.cardWidthPx - margin);
  const maxY = Math.max(margin, input.viewportHeightPx - input.cardHeightPx - margin);
  return {
    x: Math.min(Math.max(input.x, margin), maxX),
    y: Math.min(Math.max(input.y, margin), maxY),
  };
}

const COMPUTER_PREVIEW_FLOAT_EXPAND_SCALE = 1.5;

function computerPreviewFloatWidthPx(input: {
  readonly caps: ComputerPreviewCardCaps;
  readonly viewportWidthPx: number;
  readonly viewportHeightPx: number;
  readonly frameAspect: number;
}): number {
  const margins = COMPUTER_PREVIEW_FLOAT_MARGIN_PX * 2;
  return Math.max(
    input.caps.minWidthPx,
    Math.min(
      input.caps.maxWidthPx * COMPUTER_PREVIEW_FLOAT_EXPAND_SCALE,
      input.viewportWidthPx - margins,
      (input.viewportHeightPx - margins) * input.frameAspect,
    ),
  );
}

const SLOT_MARGIN_X_PX = 32;
const SLOT_TOP_PX = 16;
const SLOT_BOTTOM_RESERVE_PX = 120;

export function computerPreviewCardFitWidth(input: {
  readonly floating: boolean;
  readonly caps: ComputerPreviewCardCaps;

  readonly railBudgetPx: number | undefined;

  readonly slotWidthPx: number;
  readonly slotHeightPx: number;
  readonly frameAspect: number;
  readonly viewportWidthPx: number;
  readonly viewportHeightPx: number;
}): number {
  if (input.floating) {
    return computerPreviewFloatWidthPx({
      caps: input.caps,
      viewportWidthPx: input.viewportWidthPx,
      viewportHeightPx: input.viewportHeightPx,
      frameAspect: input.frameAspect,
    });
  }
  const widthBasis = input.railBudgetPx ?? input.slotWidthPx - SLOT_MARGIN_X_PX;
  const cardMaxWidth = Math.min(input.railBudgetPx ?? input.caps.maxWidthPx, input.caps.maxWidthPx);
  return Math.max(
    input.caps.minWidthPx,
    Math.min(
      cardMaxWidth,
      widthBasis,
      (input.slotHeightPx - SLOT_TOP_PX - SLOT_BOTTOM_RESERVE_PX) * input.frameAspect,
    ),
  );
}

export function computerPreviewBudgetPx(input: {
  readonly mainContentWidthPx: number;
  readonly environmentInsetPx: number;
  readonly caps: ComputerPreviewCardCaps;
}): number {
  const available = input.mainContentWidthPx - input.environmentInsetPx - 520 - 24;
  return Math.max(200, Math.min(input.caps.maxWidthPx, available));
}

export interface ComputerPreviewSession {
  readonly threadId: ThreadId;
  readonly phase: ComputerPreviewPhase;
  readonly lastActionLabel?: string | undefined;
}

// Not the same question the pane's Stop asks: `controlOwnerThreadId` names the lease holder on
// every thread's snapshot, so a bystander thread reports the owner too. For the popover, only the
// owning thread is driving. `agentActive` covers the in-flight call window before the lease shows
// up in the snapshot, but a call refused because another thread owns the desktop
// (`controlledByOtherThread`) is not driving.
export function computerPreviewAgentActive(state: ThreadComputerState): boolean {
  return (
    state.controlOwnerThreadId === state.threadId ||
    (state.agentActive && !state.controlledByOtherThread)
  );
}

export type ComputerPreviewAgentEdge = "rose" | "fell";

export function computerPreviewPhaseOnAgentEdge(
  phase: ComputerPreviewPhase | undefined,
  edge: ComputerPreviewAgentEdge,
): ComputerPreviewPhase | undefined {
  if (edge === "fell") {
    return phase === undefined ? undefined : "ended";
  }
  return phase === "live" ? "live" : "armed";
}

export function computerPreviewPhaseOnSurfaceRequest(
  phase: ComputerPreviewPhase | undefined,
): ComputerPreviewPhase {
  if (phase === "live" || phase === "armed") return phase;
  return "armed";
}

export function computerPreviewPhaseOnViewed(
  phase: ComputerPreviewPhase | undefined,
): ComputerPreviewPhase | undefined {
  return phase === "armed" ? "live" : phase;
}

export function computerPreviewPhaseOnHide(
  phase: ComputerPreviewPhase | undefined,
): ComputerPreviewPhase | undefined {
  return phase === "armed" || phase === "live" ? "hidden-for-task" : phase;
}

export function computerPreviewCardOpen(phase: ComputerPreviewPhase | undefined): boolean {
  return phase === "live";
}

export function computerPreviewStatusLabel(input: {
  readonly agentActive: boolean;
  readonly inputStopped?: boolean;
  readonly currentActivity: string | null;
  readonly lastActionLabel: string | null;
}): string | null {
  if (input.inputStopped === true) return "Stopped via Escape";
  if (input.agentActive) return input.currentActivity ?? input.lastActionLabel ?? "Live";
  return input.lastActionLabel;
}

export type ComputerPreviewFrameSource = "tap" | "stills" | "none";

// The stills WebSocket is the server's window/tab-scoped fallback: it draws until the tap has a
// frame, and the server publishes nothing when no window or tab is the target — a desktop-wide
// still is never a pane frame. When the tap already painted a window frame and just went quiet,
// neither source draws ("none") so the canvas keeps showing that frame. "none" also means the
// preview should not draw at all, so both sources stay off and never write the canvas
// simultaneously.
export function computerPreviewFrameSource(input: {
  readonly streamWanted: boolean;
  readonly tapActive: boolean;
  readonly tapHasFrame?: boolean | undefined;
}): ComputerPreviewFrameSource {
  if (!input.streamWanted) return "none";
  if (input.tapActive) return "tap";
  if (input.tapHasFrame === true) return "none";
  return "stills";
}

export function changedThreadComputerStates(
  next: Record<string, ThreadComputerState | undefined>,
  previous: Record<string, ThreadComputerState | undefined>,
): ThreadComputerState[] {
  const changed: ThreadComputerState[] = [];
  for (const [threadId, state] of Object.entries(next)) {
    if (state !== undefined && state !== previous[threadId]) {
      changed.push(state);
    }
  }
  return changed;
}

export function removedThreadComputerStateIds(
  next: Record<string, ThreadComputerState | undefined>,
  previous: Record<string, ThreadComputerState | undefined>,
): string[] {
  const removed: string[] = [];
  for (const threadId of Object.keys(previous)) {
    if (next[threadId] === undefined) {
      removed.push(threadId);
    }
  }
  return removed;
}
