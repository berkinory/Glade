import { Effect, Stream } from "effect";

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
