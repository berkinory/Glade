import { Cause, Duration, Effect, Option, type ServiceMap } from "effect";
import { EventId, MessageId, type ThreadId, type TurnId } from "@glade/contracts/core/baseSchemas";
import { CheckpointStore } from "../../checkpointing/Services/CheckpointStore.ts";
import { checkpointRefForThreadMessageStart } from "../../checkpointing/Utils.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { serverCommandId } from "./deliveryClaims";

// A slow or locked repository must not hold the turn: after this the snapshot is abandoned and the
// turn runs without file undo. Capture is four short Git commands on an ordinary checkout.
const PRE_TURN_BASELINE_TIMEOUT = Duration.seconds(10);
const PRE_TURN_BASELINE_PROBE_TIMEOUT = Duration.seconds(2);

export const CHECKPOINT_BASELINE_SKIPPED_ACTIVITY_KIND = "checkpoint.baseline.skipped";

const failureMessage = <E>(cause: Cause.Cause<E>) => {
  const failure = Cause.squash(cause);
  return failure instanceof Error ? failure.message : String(failure);
};

export type PreTurnBaseline =
  | { readonly status: "captured" | "not-applicable" }
  | { readonly status: "unavailable"; readonly detail: string };

/**
 * Captures the message-start snapshot before the provider is asked to run. The timeout interrupts
 * the capture and waits for its Git processes to exit, so a skipped snapshot never publishes after
 * the agent has started editing.
 */
export const capturePreTurnBaseline = <E>(input: {
  readonly checkpointStore: ServiceMap.Service.Shape<typeof CheckpointStore>;
  readonly threadId: ThreadId;
  readonly messageId: string;
  readonly resolveCwd: Effect.Effect<string | undefined, E>;
}): Effect.Effect<PreTurnBaseline> =>
  Effect.gen(function* () {
    const { checkpointStore } = input;
    const checkpointRef = checkpointRefForThreadMessageStart(
      input.threadId,
      MessageId.makeUnsafe(input.messageId),
    );
    let gitCwd: string | undefined;
    const capture = Effect.gen(function* () {
      const cwd = yield* input.resolveCwd;
      if (!cwd || !(yield* checkpointStore.isGitRepository(cwd))) {
        return { status: "not-applicable" } as const;
      }
      gitCwd = cwd;
      yield* checkpointStore.captureCheckpoint({ cwd, checkpointRef, skipIfExists: true });
      return { status: "captured" } as const;
    });
    const outcome: PreTurnBaseline = yield* capture.pipe(
      Effect.timeoutOption(PRE_TURN_BASELINE_TIMEOUT),
      Effect.map(
        Option.getOrElse(
          (): PreTurnBaseline => ({
            status: "unavailable",
            detail: `The workspace snapshot did not finish within ${Duration.toSeconds(PRE_TURN_BASELINE_TIMEOUT)} seconds.`,
          }),
        ),
      ),
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.interrupt
          : Effect.logWarning("failed to capture provider turn start checkpoint", {
              threadId: input.threadId,
              messageId: input.messageId,
              cause: Cause.pretty(cause),
            }).pipe(
              Effect.as<PreTurnBaseline>({
                status: "unavailable",
                detail: `The workspace snapshot failed: ${failureMessage(cause)}`,
              }),
            ),
      ),
    );
    if (outcome.status !== "unavailable" || gitCwd === undefined) return outcome;
    // The ref can be published just before interruption lands. Read only this exact ref.
    const published = yield* checkpointStore.hasCheckpointRef({ cwd: gitCwd, checkpointRef }).pipe(
      Effect.timeoutOption(PRE_TURN_BASELINE_PROBE_TIMEOUT),
      Effect.catch(() => Effect.succeed(Option.none<boolean>())),
    );
    return Option.getOrElse(published, () => false) ? ({ status: "captured" } as const) : outcome;
  });

export const surfaceUnavailablePreTurnBaseline = (input: {
  readonly orchestrationEngine: ServiceMap.Service.Shape<typeof OrchestrationEngineService>;
  readonly threadId: ThreadId;
  readonly turnId: TurnId;
  readonly messageId: string;
  readonly detail: string;
  readonly createdAt: string;
}) =>
  input.orchestrationEngine
    .dispatch({
      type: "thread.activity.append",
      commandId: serverCommandId("checkpoint-baseline-skipped"),
      threadId: input.threadId,
      activity: {
        id: EventId.makeUnsafe(
          `checkpoint-baseline-skipped:${checkpointRefForThreadMessageStart(
            input.threadId,
            MessageId.makeUnsafe(input.messageId),
          )}`,
        ),
        tone: "info",
        kind: CHECKPOINT_BASELINE_SKIPPED_ACTIVITY_KIND,
        summary: "Turn started without a file snapshot",
        payload: {
          detail: `${input.detail} The turn continued; its diff and file undo are unavailable.`,
          messageId: input.messageId,
        },
        turnId: input.turnId,
        createdAt: input.createdAt,
      },
      createdAt: input.createdAt,
    })
    .pipe(
      Effect.asVoid,
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.failCause(cause)
          : Effect.logWarning("failed to surface skipped pre-turn baseline", {
              threadId: input.threadId,
              cause: Cause.pretty(cause),
            }),
      ),
    );
