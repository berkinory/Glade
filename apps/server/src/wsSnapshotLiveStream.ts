import { WsRpcError } from "@glade/contracts/transport/ws/rpc";
import { type OrchestrationEvent } from "@glade/contracts/orchestration/events";
import { Cause, Effect, Queue, Scope, Stream } from "effect";

const ORCHESTRATION_SNAPSHOT_REPLAY_LIMIT = 4_096;

export type SnapshotLiveStreamItem<Snapshot> =
  | { readonly kind: "snapshot"; readonly snapshot: Snapshot }
  | { readonly kind: "event"; readonly event: OrchestrationEvent };

export interface ResnapshotReport {
  readonly snapshotSequence: number;
  readonly highWaterSequence: number;
  readonly replayCount: number;
  readonly replayLimit: number;
}

// A repeated non-advancing snapshot fence cannot recover through reconnects. Track retries per
// subscriber so concurrent clients do not count as one failure chain; clear that subscriber's chain
// after a successful start.
export function makeResnapshotEscalationTracker(): {
  readonly shouldEscalate: (streamKey: string, report: ResnapshotReport) => boolean;
  readonly recordHealthyStart: (streamKey: string) => void;
} {
  const lastDemandedFenceByStreamKey = new Map<string, number>();

  const MAX_TRACKED_STREAM_KEYS = 4_096;
  return {
    shouldEscalate: (streamKey, report) => {
      const previousFence = lastDemandedFenceByStreamKey.get(streamKey);
      lastDemandedFenceByStreamKey.delete(streamKey);
      if (lastDemandedFenceByStreamKey.size >= MAX_TRACKED_STREAM_KEYS) {
        const oldestKey = lastDemandedFenceByStreamKey.keys().next().value;
        if (oldestKey !== undefined) {
          lastDemandedFenceByStreamKey.delete(oldestKey);
        }
      }
      lastDemandedFenceByStreamKey.set(streamKey, report.snapshotSequence);
      return previousFence !== undefined && report.snapshotSequence <= previousFence;
    },
    recordHealthyStart: (streamKey) => {
      lastDemandedFenceByStreamKey.delete(streamKey);
    },
  };
}

// Subscribe to live delivery before reading the durable fence. Cursors ahead of the journal or
// beyond the replay budget require a fresh snapshot.
export function makeCursorSafeSnapshotLiveStream<Snapshot, E>(input: {
  readonly subscribeLive: Effect.Effect<Stream.Stream<OrchestrationEvent, E>, never, Scope.Scope>;
  readonly snapshot: Effect.Effect<Snapshot, E>;
  readonly snapshotSequence: (snapshot: Snapshot) => number;
  readonly getHighWaterSequence: Effect.Effect<number, E>;
  readonly replay: (
    fromSequenceExclusive: number,
    throughSequenceInclusive: number,
  ) => Stream.Stream<OrchestrationEvent, E>;
  readonly resumeFromSequence?: number | undefined;

  readonly resumeSubjectExists?: Effect.Effect<boolean, E>;
  readonly onResnapshotRequired?: (report: ResnapshotReport) => Effect.Effect<void, never>;

  readonly resnapshotEscalation?: {
    readonly streamKey: string;
    readonly tracker: ReturnType<typeof makeResnapshotEscalationTracker>;
  };
}): Stream.Stream<SnapshotLiveStreamItem<Snapshot>, E | WsRpcError> {
  return Stream.unwrap(
    Effect.gen(function* () {
      const live = yield* input.subscribeLive;
      const liveQueue = yield* Queue.bounded<OrchestrationEvent, E | Cause.Done>(1);
      yield* Stream.runIntoQueue(live, liveQueue).pipe(Effect.forkScoped);
      if (input.resumeFromSequence !== undefined) {
        const resumeFromSequence = input.resumeFromSequence;
        const highWaterSequence = yield* input.getHighWaterSequence;
        const resumeGap = highWaterSequence - resumeFromSequence;
        // Such a cursor must never be trusted for a gap replay — fall through to the full snapshot instead.
        // Sequences themselves are never reused (`sequence INTEGER PRIMARY KEY AUTOINCREMENT`), so a
        // non-negative gap cannot silently alias deleted history onto new events.
        const subjectExists =
          input.resumeSubjectExists === undefined ? true : yield* input.resumeSubjectExists;
        if (subjectExists && resumeGap >= 0 && resumeGap <= ORCHESTRATION_SNAPSHOT_REPLAY_LIMIT) {
          input.resnapshotEscalation?.tracker.recordHealthyStart(
            input.resnapshotEscalation.streamKey,
          );
          const replay = input.replay(resumeFromSequence, highWaterSequence).pipe(
            Stream.filter(
              (event) => event.sequence > resumeFromSequence && event.sequence <= highWaterSequence,
            ),
            Stream.map((event): SnapshotLiveStreamItem<Snapshot> => ({ kind: "event", event })),
          );
          const liveAfterFence = Stream.fromQueue(liveQueue).pipe(
            Stream.filter((event) => event.sequence > highWaterSequence),
            Stream.map((event): SnapshotLiveStreamItem<Snapshot> => ({ kind: "event", event })),
          );
          return Stream.concat(replay, liveAfterFence);
        }
      }
      const snapshot = yield* input.snapshot;
      const snapshotSequence = input.snapshotSequence(snapshot);
      const highWaterSequence = yield* input.getHighWaterSequence;
      const replayCount = Math.max(0, highWaterSequence - snapshotSequence);
      if (replayCount > ORCHESTRATION_SNAPSHOT_REPLAY_LIMIT) {
        const report: ResnapshotReport = {
          snapshotSequence,
          highWaterSequence,
          replayCount,
          replayLimit: ORCHESTRATION_SNAPSHOT_REPLAY_LIMIT,
        };
        if (input.onResnapshotRequired) {
          yield* input.onResnapshotRequired(report);
        }
        const escalate =
          input.resnapshotEscalation?.tracker.shouldEscalate(
            input.resnapshotEscalation.streamKey,
            report,
          ) === true;
        if (escalate) {
          return yield* new WsRpcError({
            message:
              `Orchestration snapshot is still ${replayCount} events behind after a restart; ` +
              "the snapshot fence is not advancing (a projection is stalled or missing). " +
              "Restart the server or run repair local state.",
            code: "ORCHESTRATION_SNAPSHOT_STALLED",
            retryable: false,
          });
        }
        return yield* new WsRpcError({
          message: `Orchestration snapshot is ${replayCount} events behind; restart the stream for a fresh snapshot.`,
          code: "ORCHESTRATION_RESNAPSHOT_REQUIRED",
          retryable: true,
        });
      }
      input.resnapshotEscalation?.tracker.recordHealthyStart(input.resnapshotEscalation.streamKey);

      const replay = input.replay(snapshotSequence, highWaterSequence).pipe(
        Stream.filter(
          (event) => event.sequence > snapshotSequence && event.sequence <= highWaterSequence,
        ),
        Stream.map((event): SnapshotLiveStreamItem<Snapshot> => ({ kind: "event", event })),
      );
      const liveAfterFence = Stream.fromQueue(liveQueue).pipe(
        Stream.filter((event) => event.sequence > highWaterSequence),
        Stream.map((event): SnapshotLiveStreamItem<Snapshot> => ({ kind: "event", event })),
      );

      return Stream.concat(
        Stream.succeed<SnapshotLiveStreamItem<Snapshot>>({ kind: "snapshot", snapshot }),
        Stream.concat(replay, liveAfterFence),
      );
    }),
  );
}
