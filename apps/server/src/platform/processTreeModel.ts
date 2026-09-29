export type ProcessChildrenMap = Map<number, Array<CapturedProcess>>;
export type ProcessIdentityMap = Map<number, CapturedProcess>;

export interface CapturedProcess {
  readonly pid: number;
  readonly command: string;
  /** POSIX lstart or Windows CIM CreationDate; rejects observed PID reuse. */
  readonly startedAt?: string;
}

export interface CapturedProcessTree {
  readonly descendants: CapturedProcess[];
  /** False when the platform process snapshot failed and descendant absence is unproven. */
  readonly captureComplete?: boolean;
}

export interface CapturedProcessTreeInspection {
  /** False when the process table could not be read, so exit cannot be proven. */
  readonly verified: boolean;
  readonly survivors: CapturedProcess[];
}

export type TerminalKillSignal = "SIGTERM" | "SIGKILL";

export interface ProcessTreeKiller {
  capture(rootPid: number): CapturedProcessTree;
  inspect?(tree: CapturedProcessTree): CapturedProcessTreeInspection;
  signal(input: {
    readonly rootPid: number;
    readonly signal: TerminalKillSignal;
    readonly tree: CapturedProcessTree;
    /**
     * True only when `tree.descendants` were identity-verified immediately
     * before this signal. This lets Windows use CIM CreationDate verification
     * without falling back to POSIX `ps` before forced descendant cleanup.
     */
    readonly verifiedDescendants?: boolean | undefined;
    readonly includeRootTree?: boolean | undefined;
    readonly onError: (
      error: Error,
      context: { readonly pid: number; readonly source: "tree-kill" | "captured" },
    ) => void;
  }): void;
}

export interface ProcessTreeKillerDependencies {
  readonly captureChildrenMap: () => ProcessChildrenMap | null;
  readonly readCurrentProcesses: (pids: readonly number[]) => ProcessIdentityMap | null;
  readonly signalPid: (pid: number, signal: TerminalKillSignal) => Error | null;
  readonly signalTree: (
    rootPid: number,
    signal: TerminalKillSignal,
    callback: (error?: Error | null) => void,
  ) => void;
}

export interface PlatformProcessTreeOptions {
  readonly platform?: NodeJS.Platform;
  readonly processTreeKiller?: ProcessTreeKiller;
  readonly captureWindowsChildren?: () => Promise<ProcessChildrenMap | null>;
}
