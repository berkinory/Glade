import { type ProviderRuntimeEvent } from "@glade/contracts/provider/runtimeEvents";
import { type ProviderIntentEvent } from "../providerIntentClassification.ts";
import { CommandId } from "@glade/contracts/core/baseSchemas";
import { Duration, Effect } from "effect";

export type ProviderQueueDrainEvent = Extract<
  ProviderRuntimeEvent,
  {
    type: "turn.completed" | "turn.aborted";
  }
>;

export type QueuedTurnSourceEvent =
  | Extract<ProviderIntentEvent, { type: "thread.turn-queued" }>
  | Extract<ProviderIntentEvent, { type: "thread.turn-start-requested" }>;

export const serverCommandId = (tag: string): CommandId =>
  CommandId.makeUnsafe(`server:${tag}:${crypto.randomUUID()}`);

export const turnStartKeyForEvent = (event: ProviderIntentEvent): string =>
  event.commandId !== null ? `command:${event.commandId}` : `event:${event.eventId}`;

export const HANDLED_TURN_START_KEY_MAX = 10_000;

export const HANDLED_TURN_START_KEY_TTL = Duration.minutes(30);

export const PROVIDER_COMMAND_CLAIM_LEASE_MS = 30_000;

const PROVIDER_COMMAND_CLAIM_SETTLEMENT_POLL_MS = 1_000;

interface ProviderCommandClaimSnapshot {
  readonly state: string;
  readonly claimOwner?: string | null;
  readonly claimExpiresAt?: string | null;
}

export // The wait never exceeds the caller's deadline and never steals work: it only observes, returning
// the latest snapshot for the caller to handle through the existing settled/ expired paths. Failed
// reads keep waiting on the last known snapshot so a transient store error degrades to today's
// full-lease wait, not a wrong turn.
function awaitInflightClaimSettlement<TClaim extends ProviderCommandClaimSnapshot>(input: {
  readonly readClaim: () => Effect.Effect<TClaim | undefined, never>;
  readonly deadlineMs: number;
  readonly pollIntervalMs?: number;
}): Effect.Effect<TClaim | undefined> {
  const pollIntervalMs = Math.max(
    0,
    input.pollIntervalMs ?? PROVIDER_COMMAND_CLAIM_SETTLEMENT_POLL_MS,
  );
  const startedAt = Date.now();
  const check = (): Effect.Effect<TClaim | undefined> =>
    Effect.flatMap(input.readClaim(), (snapshot) => {
      if (!snapshot || snapshot.state !== "inflight") {
        return Effect.succeed(snapshot);
      }
      const expiresAt = Date.parse(snapshot.claimExpiresAt ?? "");
      const recordRemainingMs = Number.isFinite(expiresAt) ? expiresAt - Date.now() : 0;
      const budgetRemainingMs = input.deadlineMs - (Date.now() - startedAt);
      const remainingMs = Math.min(Math.max(0, recordRemainingMs), Math.max(0, budgetRemainingMs));
      if (remainingMs <= 0) {
        return Effect.succeed(snapshot);
      }
      return Effect.flatMap(
        Effect.sleep(Duration.millis(Math.min(remainingMs, pollIntervalMs))),
        () => check(),
      );
    });
  return check();
}
