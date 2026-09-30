import { Effect } from "effect";

type Priority = "foreground" | "background";
interface Waiter {
  state: "queued" | "granted" | "claimed" | "cancelled";
  readonly grant: () => void;
}

export class GitProcessQueue {
  private active = 0;
  private readonly foreground: Waiter[] = [];
  private readonly background: Waiter[] = [];

  constructor(private readonly limit: number) {}

  private release(): void {
    this.active -= 1;
    const next = this.foreground.shift() ?? this.background.shift();
    if (next) {
      this.active += 1;
      next.grant();
    }
  }

  run<A, E, R>(effect: Effect.Effect<A, E, R>, priority: Priority): Effect.Effect<A, E, R> {
    const acquire = Effect.callback<void>((resume) => {
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
      const queue = priority === "foreground" ? this.foreground : this.background;
      if (this.active < this.limit) {
        this.active += 1;
        waiter.grant();
      } else queue.push(waiter);
      return Effect.sync(() => {
        if (waiter.state === "queued") {
          const index = queue.indexOf(waiter);
          if (index >= 0) queue.splice(index, 1);
        } else if (waiter.state === "granted") this.release();
        waiter.state = "cancelled";
      });
    });
    // Claiming a permit and installing its finalizer must be atomic with cancellation.
    const release = Effect.sync(() => this.release());
    return Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        yield* restore(acquire);
        return yield* restore(effect).pipe(Effect.ensuring(release));
      }),
    );
  }
}
