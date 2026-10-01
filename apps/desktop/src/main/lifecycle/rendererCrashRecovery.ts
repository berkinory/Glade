const RENDERER_RELOAD_BASE_DELAY_MS = 500;
export const RENDERER_RELOAD_MAX_DELAY_MS = 4_000;

// Automatic reloads allowed inside one crash streak before the user is asked instead. A renderer
// that dies deterministically (a crash on first paint, a leak that OOMs the moment state is
// restored) would otherwise reload forever, burning CPU and rewriting the same crash to disk.
export const RENDERER_MAX_AUTOMATIC_RELOADS = 3;

export const RENDERER_CRASH_STREAK_WINDOW_MS = 60_000;

const RECOVERABLE_RENDERER_CRASH_REASONS: ReadonlySet<string> = new Set(["crashed", "oom"]);

export function isRecoverableRendererCrashReason(reason: string): boolean {
  return RECOVERABLE_RENDERER_CRASH_REASONS.has(reason);
}

export function rendererReloadDelayMs(attempt: number): number {
  const step = Math.max(1, Math.floor(attempt)) - 1;
  return Math.min(RENDERER_RELOAD_BASE_DELAY_MS * 2 ** step, RENDERER_RELOAD_MAX_DELAY_MS);
}

export type RendererCrashResponse =
  | { readonly kind: "ignore" }
  | { readonly kind: "reload"; readonly delayMs: number; readonly attempt: number }
  | {
      readonly kind: "prompt";
      readonly cause: "unrecoverable" | "reload-budget-exhausted";
      readonly crashes: number;
    };

export interface RendererCrashInput {
  readonly reason: string;
  readonly quitting: boolean;
  readonly nowMs: number;
}

export class RendererCrashPolicy {
  private crashes = 0;
  private lastCrashAtMs: number | null = null;

  get crashStreak(): number {
    return this.crashes;
  }

  reset(): void {
    this.crashes = 0;
    this.lastCrashAtMs = null;
  }

  respondToCrash(input: RendererCrashInput): RendererCrashResponse {
    if (input.quitting || input.reason === "clean-exit") {
      return { kind: "ignore" };
    }

    if (
      this.lastCrashAtMs !== null &&
      input.nowMs - this.lastCrashAtMs > RENDERER_CRASH_STREAK_WINDOW_MS
    ) {
      this.crashes = 0;
    }
    this.lastCrashAtMs = input.nowMs;
    this.crashes += 1;

    if (!isRecoverableRendererCrashReason(input.reason)) {
      return { kind: "prompt", cause: "unrecoverable", crashes: this.crashes };
    }

    if (this.crashes > RENDERER_MAX_AUTOMATIC_RELOADS) {
      return { kind: "prompt", cause: "reload-budget-exhausted", crashes: this.crashes };
    }

    return {
      kind: "reload",
      delayMs: rendererReloadDelayMs(this.crashes),
      attempt: this.crashes,
    };
  }
}
