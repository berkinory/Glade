import { Exit, Cause, Option, Schema, Duration, Effect } from "effect";
import { ProviderAdapterProcessError } from "../../provider/core/Errors.ts";

export class ProviderCommandExecutionError extends Error {
  readonly _tag = "ProviderCommandExecutionError";
}

export type ProviderAttemptOutcome =
  | { readonly _tag: "accepted" }
  | { readonly _tag: "rejected"; readonly detail: string }
  | { readonly _tag: "safe_retry"; readonly detail: string }
  | { readonly _tag: "uncertain"; readonly detail: string };

export function classifyProviderAttemptOutcome(
  exit: Exit.Exit<void, unknown>,
): ProviderAttemptOutcome {
  if (Exit.isSuccess(exit)) return { _tag: "accepted" };
  const detail = Cause.pretty(exit.cause);

  if (exit.cause.reasons.length !== 1) return { _tag: "uncertain", detail };
  const failure = Cause.findErrorOption(exit.cause);
  if (Option.isNone(failure)) return { _tag: "uncertain", detail };

  const tag = (failure.value as { readonly _tag?: string })._tag;
  switch (tag) {
    case "ProviderAdapterValidationError":
    case "ProviderAdapterSessionNotFoundError":
    case "ProviderAdapterSessionClosedError":
    case "ProviderValidationError":
    case "ProviderUnsupportedError":
    case "ProviderSessionNotFoundError":
      return { _tag: "rejected", detail };
    case "ProviderAdapterProcessError":
      return (failure.value as ProviderAdapterProcessError).reason === "startup-failed"
        ? { _tag: "rejected", detail }
        : { _tag: "uncertain", detail };
    case "PersistenceSqlError":
    case "PersistenceDecodeError":
      return { _tag: "safe_retry", detail };
    default:
      return { _tag: "uncertain", detail };
  }
}

export function providerFailureMessage(cause: Cause.Cause<unknown>): string {
  const failure = Option.getOrUndefined(Cause.findErrorOption(cause));
  const message =
    Schema.is(ProviderAdapterProcessError)(failure) && failure.detail.trim()
      ? failure.detail
      : failure instanceof Error && failure.message.trim()
        ? failure.message
        : Cause.pretty(cause);
  return message.split(/\r?\n/u, 1)[0]?.trim() || "Provider request failed.";
}

type BoundedProviderCallResult<E> =
  | { readonly _tag: "ok" }
  | { readonly _tag: "timeout"; readonly detail: string }
  | {
      readonly _tag: "failed";
      readonly outcome: Exclude<ProviderAttemptOutcome, { readonly _tag: "accepted" }>;
      readonly cause: Cause.Cause<E>;
    };

export // Runs a provider call under a hard deadline and reduces it to a decision. A call that never
// returns cannot simply be awaited here: the caller holds the reactor's single delivery permit, so
// waiting forever stalls every thread. Interruption is re-raised untouched so shutdown still
// cancels cleanly.
const runBoundedProviderCall = <E, R>(input: {
  readonly label: string;
  readonly timeout: Duration.Duration;
  readonly call: Effect.Effect<unknown, E, R>;
}): Effect.Effect<BoundedProviderCallResult<E>, E, R> =>
  Effect.suspend(() => {
    let timedOut = false;
    return input.call.pipe(
      Effect.timeoutOption(input.timeout),
      Effect.flatMap((result) =>
        Effect.sync(() => {
          timedOut = Option.isNone(result);
        }),
      ),
      Effect.exit,
      Effect.flatMap(
        (exit): Effect.Effect<BoundedProviderCallResult<E>, E> =>
          Exit.isSuccess(exit)
            ? Effect.succeed(
                timedOut
                  ? {
                      _tag: "timeout",
                      detail: `${input.label} did not respond within ${Duration.toMillis(input.timeout)}ms.`,
                    }
                  : { _tag: "ok" },
              )
            : Cause.hasInterruptsOnly(exit.cause)
              ? Effect.failCause(exit.cause)
              : Effect.sync((): BoundedProviderCallResult<E> => {
                  const outcome = classifyProviderAttemptOutcome(exit);
                  return {
                    _tag: "failed",

                    outcome:
                      outcome._tag === "accepted"
                        ? { _tag: "uncertain", detail: Cause.pretty(exit.cause) }
                        : outcome,
                    cause: exit.cause,
                  };
                }),
      ),
    );
  });

export function isSafeLegacyProviderBlocker(lastError: string | null): boolean {
  const normalized = lastError?.toLowerCase() ?? "";
  return (
    normalized.includes("stdin closed before the frame was written") ||
    (normalized.includes("thread/rollback") && normalized.includes("unknown variant"))
  );
}

export const PROVIDER_COMMAND_SAFE_RETRY_LIMIT = 3;

export const PROVIDER_COMMAND_SAFE_RETRY_DELAY = Duration.millis(50);

export // Every provider intent runs under a single process-wide delivery lock, so an unbounded provider
// call does not stall one thread — it stalls the reactor, which back-pressures the orchestration
// event PubSub and eventually times out every dispatched command. These deadlines make "hung"
// degrade into a normal terminal delivery failure instead of a process-wide deadlock.
const PROVIDER_COMMAND_INTERRUPT_TIMEOUT = Duration.seconds(10);

export const PROVIDER_COMMAND_STOP_TIMEOUT = Duration.seconds(15);

export const PROVIDER_COMMAND_EVENT_TIMEOUT = Duration.seconds(120);
