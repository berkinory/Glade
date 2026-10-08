import { Effect } from "effect";

export type GitProcessClass = "checkpoint" | "foreground" | "background";

export interface GitProcessQueueOptions {
  readonly limit: number;
  /** Slots only this class may take while it is not already using them. */
  readonly reserved: Partial<Record<GitProcessClass, number>>;
  readonly maxQueuedPerClass: number;
}

interface Waiter {
  state: "queued" | "granted" | "claimed" | "cancelled";
  readonly grant: () => void;
}

const GRANT_ORDER: readonly GitProcessClass[] = ["checkpoint", "foreground", "background"];

export class GitProcessQueue {
  private readonly active: Record<GitProcessClass, number> = {
    checkpoint: 0,
    foreground: 0,
    background: 0,
  };
  private readonly queued: Record<GitProcessClass, Waiter[]> = {
    checkpoint: [],
    foreground: [],
    background: [],
  };
  // Higher classes win free slots, so count how often a waiting background read was passed over.
  private backgroundBypasses = 0;

  constructor(private readonly options: GitProcessQueueOptions) {}

  private totalActive(): number {
    return this.active.checkpoint + this.active.foreground + this.active.background;
  }

  private canStart(processClass: GitProcessClass): boolean {
    let heldForOthers = 0;
    for (const other of GRANT_ORDER) {
      if (other === processClass) continue;
      heldForOthers += Math.max(0, (this.options.reserved[other] ?? 0) - this.active[other]);
    }
    return this.totalActive() < this.options.limit - heldForOthers;
  }

  private start(processClass: GitProcessClass, waiter: Waiter): void {
    this.active[processClass] += 1;
    if (processClass === "background") this.backgroundBypasses = 0;
    else if (this.queued.background.length > 0) this.backgroundBypasses += 1;
    waiter.grant();
  }

  private nextClass(): GitProcessClass | undefined {
    const backgroundDue =
      this.backgroundBypasses >= this.options.limit &&
      this.queued.background.length > 0 &&
      this.canStart("background");
    if (backgroundDue) return "background";
    return GRANT_ORDER.find(
      (candidate) => this.queued[candidate].length > 0 && this.canStart(candidate),
    );
  }

  private drain(): void {
    for (let next = this.nextClass(); next !== undefined; next = this.nextClass()) {
      this.start(next, this.queued[next].shift()!);
    }
  }

  private release(processClass: GitProcessClass): void {
    this.active[processClass] -= 1;
    this.drain();
  }

  /** Fails with `overloaded()` instead of waiting once this class's queue is full. */
  run<A, E, R, E2>(
    effect: Effect.Effect<A, E, R>,
    processClass: GitProcessClass,
    overloaded: () => E2,
  ): Effect.Effect<A, E | E2, R> {
    const acquire = Effect.callback<void, E2>((resume) => {
      const waiter: Waiter = {
        state: "queued",
        grant: () => {
          waiter.state = "granted";
          resume(
            Effect.sync(() => {
              waiter.state = "claimed";
            }),
          );
        },
      };
      const queue = this.queued[processClass];
      // FIFO within a class: a newcomer never overtakes an earlier waiter of the same class.
      if (queue.length === 0 && this.canStart(processClass)) this.start(processClass, waiter);
      else if (queue.length >= this.options.maxQueuedPerClass) {
        waiter.state = "cancelled";
        resume(Effect.fail(overloaded()));
      } else queue.push(waiter);
      return Effect.sync(() => {
        if (waiter.state === "queued") {
          const index = queue.indexOf(waiter);
          if (index >= 0) queue.splice(index, 1);
        } else if (waiter.state === "granted") this.release(processClass);
        waiter.state = "cancelled";
      });
    });
    // Claiming a permit and installing its finalizer must be atomic with cancellation.
    const release = Effect.sync(() => this.release(processClass));
    return Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        yield* restore(acquire);
        return yield* restore(effect).pipe(Effect.ensuring(release));
      }),
    );
  }
}
