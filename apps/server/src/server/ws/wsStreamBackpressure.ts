import { WS_STREAM_OVERFLOW_CODE, WsRpcError } from "@glade/contracts/transport/ws/rpcErrors";
import * as Arr from "effect/Array";
import { Cause, Deferred, Effect, Exit, Queue, Scope, Stream } from "effect";

const DEFAULT_LIVE_UI_STREAM_BUFFER_CAPACITY = 1_024;
const DROP_REPORT_GROWTH_STEP = 500;

interface LiveUiStreamLagState {
  ingressCount: number;
  egressCount: number;
  reportedDroppedAtLeast: number;
}

export interface LiveUiStreamDropReport {
  readonly capacity: number;
  readonly droppedAtLeast: number;
  readonly label: string;
  readonly message: string;
}

function makeLiveUiStreamLagState(): LiveUiStreamLagState {
  return { ingressCount: 0, egressCount: 0, reportedDroppedAtLeast: 0 };
}

function normalizeLiveUiStreamBufferCapacity(capacity: number): number {
  if (!Number.isFinite(capacity)) {
    return DEFAULT_LIVE_UI_STREAM_BUFFER_CAPACITY;
  }
  return Math.max(1, Math.floor(capacity));
}

function recordLiveUiStreamIngress(
  state: LiveUiStreamLagState,
  capacity: number,
  reportGrowthStep = DROP_REPORT_GROWTH_STEP,
): number | null {
  state.ingressCount += 1;
  const droppedAtLeast = state.ingressCount - state.egressCount - capacity;
  if (droppedAtLeast <= 0) {
    return null;
  }
  if (
    state.reportedDroppedAtLeast > 0 &&
    droppedAtLeast - state.reportedDroppedAtLeast < reportGrowthStep
  ) {
    return null;
  }
  state.reportedDroppedAtLeast = droppedAtLeast;
  return droppedAtLeast;
}

export interface BufferLiveUiStreamOptions<E2 = never, R2 = never> {
  readonly capacity?: number;

  readonly label?: string;

  readonly onDroppedEvents?: (report: LiveUiStreamDropReport) => Effect.Effect<void, E2, R2>;
}

export function bufferLiveUiStream<A, E, R>(
  stream: Stream.Stream<A, E, R>,
  options?: BufferLiveUiStreamOptions,
): Stream.Stream<A, E, R>;
export function bufferLiveUiStream<A, E, R, E2, R2>(
  stream: Stream.Stream<A, E, R>,
  options: BufferLiveUiStreamOptions<E2, R2> & {
    readonly onDroppedEvents: (report: LiveUiStreamDropReport) => Effect.Effect<void, E2, R2>;
  },
): Stream.Stream<A, E | E2, R | R2>;
export function bufferLiveUiStream<A, E, R, E2 = never, R2 = never>(
  stream: Stream.Stream<A, E, R>,
  options?: BufferLiveUiStreamOptions<E2, R2>,
): Stream.Stream<A, E | E2, R | R2> {
  const capacity = normalizeLiveUiStreamBufferCapacity(
    options?.capacity ?? DEFAULT_LIVE_UI_STREAM_BUFFER_CAPACITY,
  );
  const label = options?.label ?? "live-ui-stream";
  return Stream.unwrap(
    Effect.sync(() => {
      const lagState = makeLiveUiStreamLagState();
      return stream.pipe(
        Stream.tap(() => {
          const droppedAtLeast = recordLiveUiStreamIngress(lagState, capacity);
          if (droppedAtLeast === null) {
            return Effect.void;
          }
          const report: LiveUiStreamDropReport = {
            capacity,
            droppedAtLeast,
            label,
            message: `[ws-stream] slow "${label}" subscriber: dropped at least ${droppedAtLeast} oldest events (capacity=${capacity})`,
          };
          const recover = options?.onDroppedEvents ?? (() => Effect.void);
          return Effect.logWarning(report.message).pipe(Effect.andThen(recover(report)));
        }),
        Stream.buffer({ capacity, strategy: "sliding" }),
        Stream.tap(() =>
          Effect.sync(() => {
            lagState.egressCount += 1;
          }),
        ),
      );
    }),
  );
}

// Snapshot-backed streams must never drop events silently: a gap would leave the client's cursor
// vouching for data it never received. They fail with a retryable overflow instead, and the client
// resumes only that subscription from its last applied cursor or a fresh snapshot.
const DEFAULT_LIVE_UI_STREAM_MAX_BYTES = 8 * 1024 * 1024;

// Domain events are immutable objects shared by every subscriber; cache only their wire size.
const serializedSizes = new WeakMap<object, number>();

export function serializedByteLength(value: unknown): number {
  if (value === null || typeof value !== "object") {
    return Buffer.byteLength(JSON.stringify(value) ?? "null");
  }
  const cached = serializedSizes.get(value);
  if (cached !== undefined) return cached;
  const bytes = Buffer.byteLength(JSON.stringify(value));
  serializedSizes.set(value, bytes);
  return bytes;
}

export interface BoundedLiveStream<A, E> {
  readonly stream: Stream.Stream<A, E | WsRpcError>;
  // Fails once the budget overflows or the source fails; lets finite snapshot work stop early.
  readonly failure: Effect.Effect<never, E | WsRpcError>;
  // Drops retained values the subscriber no longer needs and stops admitting them.
  readonly retainOnly: (keep: (value: A) => boolean) => Effect.Effect<void>;
}

interface RetainedValue<A> {
  readonly value: A;
  readonly bytes: number;
}

// Drains the source eagerly, so events that arrive while the snapshot loads or while the client
// has not yet acknowledged a chunk are counted. A delivered chunk stays charged until the next pull,
// which the RPC server issues only after the client acknowledges that chunk.
export function makeBoundedLiveStream<A, E, R>(
  source: Stream.Stream<A, E, R>,
  options: {
    readonly label: string;
    readonly capacity?: number;
    readonly maxBytes?: number;
    readonly onOverflow?: (report: LiveUiStreamDropReport) => Effect.Effect<void>;
  },
): Effect.Effect<BoundedLiveStream<A, E>, never, Scope.Scope | R> {
  return Effect.gen(function* () {
    const capacity = normalizeLiveUiStreamBufferCapacity(
      options.capacity ?? DEFAULT_LIVE_UI_STREAM_BUFFER_CAPACITY,
    );
    const maxBytes = options.maxBytes ?? DEFAULT_LIVE_UI_STREAM_MAX_BYTES;
    const queue = yield* Queue.unbounded<RetainedValue<A>, E | WsRpcError | Cause.Done>();
    const failed = yield* Deferred.make<never, E | WsRpcError>();
    let keep: (value: A) => boolean = () => true;
    let retainedCount = 0;
    let retainedBytes = 0;
    let delivered: ReadonlyArray<RetainedValue<A>> = [];
    let sourceDone = false;
    let overflowed = false;

    const release = (values: Iterable<RetainedValue<A>>) => {
      for (const retained of values) {
        retainedCount -= 1;
        retainedBytes -= retained.bytes;
      }
    };
    const takeQueued = () => {
      const values: Array<RetainedValue<A>> = [];
      for (;;) {
        const next = Queue.takeUnsafe(queue);
        if (next === undefined || Exit.isFailure(next)) return values;
        values.push(next.value);
      }
    };
    const endIfDrained = () => {
      if (sourceDone && Queue.sizeUnsafe(queue) === 0) Queue.endUnsafe(queue);
    };
    const failWith = (cause: Cause.Cause<E | WsRpcError>) =>
      Effect.sync(() => {
        takeQueued();
        delivered = [];
        retainedCount = 0;
        retainedBytes = 0;
        Queue.failCauseUnsafe(queue, cause);
      }).pipe(Effect.andThen(Deferred.failCause(failed, cause)));

    const admit = (value: A): Effect.Effect<void, WsRpcError> => {
      if (!keep(value)) return Effect.void;
      const bytes = serializedByteLength(value);
      if (retainedCount + 1 <= capacity && retainedBytes + bytes <= maxBytes) {
        retainedCount += 1;
        retainedBytes += bytes;
        Queue.offerUnsafe(queue, { value, bytes });
        return Effect.void;
      }
      overflowed = true;
      const report: LiveUiStreamDropReport = {
        capacity,
        droppedAtLeast: 1,
        label: options.label,
        message: `[ws-stream] slow "${options.label}" subscriber exceeded its live budget (events=${retainedCount + 1}/${capacity}, bytes=${retainedBytes + bytes}/${maxBytes})`,
      };
      // Free retained events before the diagnostic hook runs; the subscription fails right after.
      takeQueued();
      return Effect.logWarning(report.message).pipe(
        Effect.andThen(options.onOverflow?.(report) ?? Effect.void),
        Effect.andThen(
          Effect.fail(
            new WsRpcError({
              message: `${report.message}; resume from the last applied sequence.`,
              code: WS_STREAM_OVERFLOW_CODE,
              retryable: true,
            }),
          ),
        ),
      );
    };

    yield* source.pipe(
      Stream.runForEach(admit),
      Effect.matchCauseEffect({
        onSuccess: () =>
          Effect.sync(() => {
            sourceDone = true;
            endIfDrained();
          }),
        onFailure: (cause) => (Cause.hasInterruptsOnly(cause) ? Effect.void : failWith(cause)),
      }),
      Effect.forkScoped,
    );

    const pull = Effect.suspend(() => {
      release(delivered);
      delivered = [];
      return Queue.takeAll(queue);
    }).pipe(
      Effect.map((values) => {
        delivered = values;
        endIfDrained();
        return Arr.map(values, (retained) => retained.value);
      }),
    );

    return {
      stream: Stream.fromPull(Effect.succeed(pull)),
      failure: Deferred.await(failed),
      retainOnly: (predicate) =>
        Effect.sync(() => {
          keep = predicate;
          if (overflowed) return;
          for (const retained of takeQueued()) {
            if (keep(retained.value)) Queue.offerUnsafe(queue, retained);
            else release([retained]);
          }
          endIfDrained();
        }),
    };
  });
}
