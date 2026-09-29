// So the failure is the backend. `availability()` reports it, `health()` reports it as the last
// failure, `capabilities()` is empty because nothing is possible, and every action rejects with the
// same words.
import type {
  ComputerAccessibilityTreeApp,
  ComputerAccessibilityTreeWindow,
  ComputerApp,
  ComputerAvailability,
  ComputerCapabilities,
  ComputerCursorPosition,
  ComputerHealth,
  ComputerId,
  ComputerLaunchAppResult,
  ComputerScreenSize,
  ComputerScreenshot,
  ComputerState,
  ComputerVerifyStateResult,
  ComputerWindow,
  ComputerZoomResult,
} from "@glade/contracts";

import {
  clampComputerMessage,
  ComputerBackendError,
  DEFAULT_COMPUTER_ID,
  NO_COMPUTER_CAPABILITIES,
  type ComputerBackend,
  type ComputerBackendEventListener,
} from "./ComputerBackend.ts";

const FALLBACK_MESSAGE = "The Glade computer backend is unavailable for an unstated reason.";

export interface UnavailableComputerBackendOptions {
  readonly computerId?: string;
  readonly now?: () => number;
  // Replaces the default `backend-unavailable` verdict, for platforms where there is no backend
  // because none could exist: the pane keys its blocked copy off the verdict kind, and "unsupported
  // platform" is a different sentence from "the backend failed".
  readonly availability?: ComputerAvailability;
}

export class UnavailableComputerBackend implements ComputerBackend {
  readonly computerId: ComputerId;

  private readonly message: string;
  private readonly at: string;
  private readonly availabilityVerdict: ComputerAvailability | undefined;

  constructor(message: string, options: UnavailableComputerBackendOptions = {}) {
    this.computerId = (options.computerId ?? DEFAULT_COMPUTER_ID) as ComputerId;
    this.message = clampComputerMessage(message, FALLBACK_MESSAGE);
    this.at = new Date((options.now ?? Date.now)()).toISOString();
    this.availabilityVerdict = options.availability;
  }

  availability(): Promise<ComputerAvailability> {
    return Promise.resolve(
      this.availabilityVerdict ?? { kind: "backend-unavailable", message: this.message },
    );
  }

  probeAvailability(): Promise<ComputerAvailability> {
    return this.availability();
  }

  health(): ComputerHealth {
    return {
      status: "unavailable",
      consecutiveFailures: 1,
      reconnects: 0,
      lastFailure: { message: this.message, at: this.at },
      captureAvailable: false,
    };
  }

  capabilities(): ComputerCapabilities {
    return NO_COMPUTER_CAPABILITIES;
  }

  listWindows(): Promise<readonly ComputerWindow[]> {
    return this.refuse();
  }

  getScreenSize(): Promise<ComputerScreenSize> {
    return this.refuse();
  }

  getState(): Promise<ComputerState> {
    return this.refuse();
  }

  captureScreenshot(): Promise<ComputerScreenshot> {
    return this.refuse();
  }

  launchApp(): Promise<ComputerLaunchAppResult> {
    return this.refuse();
  }

  listApps(): Promise<readonly ComputerApp[]> {
    return this.refuse();
  }

  setWindowFrame(): Promise<never> {
    return this.refuse();
  }

  invokeMenu(): Promise<never> {
    return this.refuse();
  }

  setWindowMinimized(): Promise<never> {
    return this.refuse();
  }

  setAppVisibility(): Promise<never> {
    return this.refuse();
  }

  verifyState(): Promise<ComputerVerifyStateResult> {
    return this.refuse();
  }

  zoomWindow(): Promise<ComputerZoomResult> {
    return this.refuse();
  }

  getAccessibilityTree(): Promise<{
    readonly apps: readonly ComputerAccessibilityTreeApp[];
    readonly windows: readonly ComputerAccessibilityTreeWindow[];
    readonly truncated: boolean;
  }> {
    return this.refuse();
  }

  getCursorPosition(): Promise<Omit<ComputerCursorPosition, "computerId" | "availability">> {
    return this.refuse();
  }

  killApp(): Promise<never> {
    return this.refuse();
  }

  click(): Promise<never> {
    return this.refuse();
  }

  doubleClick(): Promise<never> {
    return this.refuse();
  }

  tripleClick(): Promise<never> {
    return this.refuse();
  }

  rightClick(): Promise<never> {
    return this.refuse();
  }

  moveCursor(): Promise<never> {
    return this.refuse();
  }

  drag(): Promise<never> {
    return this.refuse();
  }

  scroll(): Promise<never> {
    return this.refuse();
  }

  typeText(): Promise<never> {
    return this.refuse();
  }

  pressKey(): Promise<never> {
    return this.refuse();
  }

  hotkey(): Promise<never> {
    return this.refuse();
  }

  setValue(): Promise<never> {
    return this.refuse();
  }

  performAction(): Promise<never> {
    return this.refuse();
  }

  selectText(): Promise<never> {
    return this.refuse();
  }

  onEvent(_listener: ComputerBackendEventListener): () => void {
    return () => undefined;
  }

  attachStream(): Promise<void> {
    return this.refuse();
  }

  detachStream(): Promise<void> {
    return Promise.resolve();
  }

  readonly browser = {
    call: (): Promise<never> => this.refuse(),
  };

  dispose(): void {}

  private refuse(): Promise<never> {
    return Promise.reject(new ComputerBackendError(this.message, { retryable: false }));
  }
}
