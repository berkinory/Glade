import type { DesktopUpdateState } from "@glade/contracts/ipc/ipc";
import type { CancellationToken } from "electron-updater";
import type { UpdateArtifactIdentity } from "./updateArtifactIdentity";
import type { UpdateInstallHandoffExpectation } from "./updateInstallMarker";

import { PendingUpdateCacheClearQueue } from "./updatePendingCache";
import type { DownloadProgressSample } from "./updateState";

export interface UpdateStatus {
  configured: boolean;
  state: DesktopUpdateState;
  automaticActivitySuppressed: boolean;
  cacheDirectoryName: string | null;
  checkInFlight: boolean;
}

export interface UpdateActivityState {
  startupTimer: NodeJS.Timeout | null;
  pollTimer: NodeJS.Timeout | null;
  backgroundedAtMs: number | null;
  backgroundBlurTimer: NodeJS.Timeout | null;
  checkTimeoutTimer: NodeJS.Timeout | null;
  activeCheck: Promise<void> | null;
  settleActiveCheck: (() => void) | null;
}

export interface UpdateDownloadState {
  inFlight: boolean;
  stallTimer: NodeJS.Timeout | null;
  cancellationToken: CancellationToken | null;
  rejectStall: ((error: Error) => void) | null;
  lastProgressSample: DownloadProgressSample | null;
  artifact: { readonly version: string; readonly identity: UpdateArtifactIdentity } | null;
  identityTask: Promise<void> | null;
  activePreparation: Promise<void> | null;
}

export interface UpdateInstallState {
  preparing: boolean;
  handoffInFlight: boolean;
  preparation: ReturnType<typeof makeUpdateInstallPreparationCoordinator>;
  activeHandoff: UpdateInstallHandoffExpectation | null;
  watchdogTimer: NodeJS.Timeout | null;
}

export interface UpdateCacheState {
  pendingClear: PendingUpdateCacheClearQueue;
}

export interface UpdateCancellationState {
  suppressionsRemaining: number;
  suppressionExpiresAtMs: number;
}

export function createUpdateDomainState(initialState: DesktopUpdateState) {
  const status: UpdateStatus = {
    configured: false,
    state: initialState,
    automaticActivitySuppressed: false,
    cacheDirectoryName: null,
    checkInFlight: false,
  };
  const activity: UpdateActivityState = {
    startupTimer: null,
    pollTimer: null,
    backgroundedAtMs: null,
    backgroundBlurTimer: null,
    checkTimeoutTimer: null,
    activeCheck: null,
    settleActiveCheck: null,
  };
  const download: UpdateDownloadState = {
    inFlight: false,
    stallTimer: null,
    cancellationToken: null,
    rejectStall: null,
    lastProgressSample: null,
    artifact: null,
    identityTask: null,
    activePreparation: null,
  };
  const install: UpdateInstallState = {
    preparing: false,
    handoffInFlight: false,
    preparation: makeUpdateInstallPreparationCoordinator(),
    activeHandoff: null,
    watchdogTimer: null,
  };
  const cache: UpdateCacheState = { pendingClear: new PendingUpdateCacheClearQueue() };
  const cancellation: UpdateCancellationState = {
    suppressionsRemaining: 0,
    suppressionExpiresAtMs: 0,
  };
  return { status, activity, download, install, cache, cancellation };
}

export type UpdateInstallPreparationAttempt = symbol;

export class UpdateInstallPreparationCancelledError extends Error {
  constructor() {
    super("Update install preparation was cancelled.");
    this.name = "UpdateInstallPreparationCancelledError";
  }
}

export function makeUpdateInstallPreparationCoordinator() {
  let activeAttempt: {
    readonly token: UpdateInstallPreparationAttempt;
    cancelled: boolean;
  } | null = null;

  return {
    begin(): UpdateInstallPreparationAttempt | null {
      if (activeAttempt !== null) {
        return null;
      }
      const attempt = Symbol("update-install-preparation");
      activeAttempt = { token: attempt, cancelled: false };
      return attempt;
    },
    cancel(): boolean {
      if (activeAttempt === null) {
        return false;
      }
      activeAttempt.cancelled = true;
      return true;
    },
    requireActive(attempt: UpdateInstallPreparationAttempt): void {
      if (activeAttempt?.token !== attempt || activeAttempt.cancelled) {
        throw new UpdateInstallPreparationCancelledError();
      }
    },
    release(attempt: UpdateInstallPreparationAttempt): void {
      if (activeAttempt?.token !== attempt) {
        throw new UpdateInstallPreparationCancelledError();
      }
      activeAttempt = null;
    },
  };
}
