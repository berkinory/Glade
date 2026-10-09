import { Clock, Effect, Ref } from "effect";

import { AuthError } from "./Services/ServerAuth";

const FAILURE_WINDOW_MS = 10 * 60_000;
const MAX_FAILURES_PER_WINDOW = 10;

interface BootstrapAttempts {
  // Fails with 429 while the address has used up its failed attempts for the window.
  readonly admit: (address: string | undefined) => Effect.Effect<void, AuthError>;
  readonly recordFailure: (address: string | undefined) => Effect.Effect<void>;
}

// Throttles guessing pairing secrets per source address. Secrets are long enough that guessing is
// hopeless anyway; the limit keeps a misbehaving client from hammering the server and the log.
export const makeBootstrapAttempts = Effect.gen(function* () {
  const failuresRef = yield* Ref.make(new Map<string, ReadonlyArray<number>>());
  const keyOf = (address: string | undefined) => address ?? "unknown";

  const recentFailures = (address: string | undefined, now: number) =>
    Ref.modify(failuresRef, (current) => {
      const recent = (current.get(keyOf(address)) ?? []).filter(
        (at) => now - at < FAILURE_WINDOW_MS,
      );
      const next = new Map(current);
      if (recent.length === 0) next.delete(keyOf(address));
      else next.set(keyOf(address), recent);
      return [recent, next] as const;
    });

  const admit: BootstrapAttempts["admit"] = (address) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const recent = yield* recentFailures(address, now);
      if (recent.length < MAX_FAILURES_PER_WINDOW) return;
      return yield* new AuthError({
        message: "Too many pairing attempts. Try again in a few minutes.",
        status: 429,
      });
    });

  const recordFailure: BootstrapAttempts["recordFailure"] = (address) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const recent = yield* recentFailures(address, now);
      yield* Ref.update(failuresRef, (current) =>
        new Map(current).set(keyOf(address), [...recent, now]),
      );
    });

  return { admit, recordFailure } satisfies BootstrapAttempts;
});
