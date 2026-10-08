import { monitorEventLoopDelay, performance, type IntervalHistogram } from "node:perf_hooks";

import type { ServerRuntimeStatus } from "@glade/contracts/server/runtimeStatus";
import { Effect, Layer, ServiceMap } from "effect";

const SAMPLE_MS = 1_000;
const WINDOW_MS = 30_000;
const STALL_MS = 2_000;
const RESOLUTION_MS = 20;

type SampleOutcome =
  | { readonly kind: "steady" }
  | { readonly kind: "stall" | "idle-gap"; readonly durationMs: number };

const histogramDelayMs = (histogram: IntervalHistogram, read: (h: IntervalHistogram) => number) =>
  histogram.count > 0 ? Math.max(0, read(histogram) / 1e6 - RESOLUTION_MS) : 0;

// Pure sampling state, driven by the scoped fiber below. Delay is the larger of the native
// histogram and our own timer drift. A delay only counts as a stall when event-loop utilization
// shows the loop was actually busy for that long; otherwise the process was suspended or
// descheduled (sleep, CPU starvation) and the gap is counted separately, never as a stall.
function makeEventLoopSampler() {
  const interval = monitorEventLoopDelay({ resolution: RESOLUTION_MS });
  const window = monitorEventLoopDelay({ resolution: RESOLUTION_MS });
  interval.enable();
  window.enable();
  let lastSampleAt = performance.now();
  let windowStartedAt = lastSampleAt;
  let previousElu = performance.eventLoopUtilization();
  let utilization = 0;
  // Bun reports zero utilization; without it a stall cannot be told apart from a suspension.
  let utilizationAvailable = true;
  let stallCount = 0;
  let idleGapCount = 0;
  let lastStall: { readonly durationMs: number; readonly at: number } | null = null;

  return {
    sample(): SampleOutcome {
      const now = performance.now();
      const elapsed = Math.max(0, now - lastSampleAt);
      lastSampleAt = now;
      const delayMs = Math.max(
        histogramDelayMs(interval, (h) => h.max),
        Math.max(0, elapsed - SAMPLE_MS),
      );
      interval.reset();
      const elu = performance.eventLoopUtilization();
      const delta = performance.eventLoopUtilization(elu, previousElu);
      previousElu = elu;
      utilization = delta.utilization;
      if (elapsed > 0 && delta.active + delta.idle === 0) utilizationAvailable = false;
      if (now - windowStartedAt >= WINDOW_MS) {
        window.reset();
        windowStartedAt = now;
      }
      if (delayMs < STALL_MS || !utilizationAvailable) return { kind: "steady" };
      const durationMs = Math.round(delayMs);
      if (delta.active + Math.max(RESOLUTION_MS, delayMs * 0.002) < delayMs) {
        idleGapCount += 1;
        // An idle gap also skews the delay percentiles; start a fresh window.
        window.reset();
        windowStartedAt = now;
        return { kind: "idle-gap", durationMs };
      }
      stallCount += 1;
      lastStall = { durationMs, at: now };
      return { kind: "stall", durationMs };
    },
    status(): ServerRuntimeStatus {
      return {
        available: utilizationAvailable,
        delayP99Ms: histogramDelayMs(window, (h) => h.percentile(99)),
        delayMaxMs: histogramDelayMs(window, (h) => h.max),
        utilization: Math.min(1, Math.max(0, utilization)),
        stallCount,
        idleGapCount,
        lastStall:
          lastStall === null
            ? null
            : {
                durationMs: lastStall.durationMs,
                ageMs: Math.round(Math.max(0, performance.now() - lastStall.at)),
              },
      };
    },
    stop() {
      interval.disable();
      window.disable();
    },
  };
}

export interface ServerEventLoopMonitorShape {
  readonly status: Effect.Effect<ServerRuntimeStatus>;
}

export class ServerEventLoopMonitor extends ServiceMap.Service<
  ServerEventLoopMonitor,
  ServerEventLoopMonitorShape
>()("glade/serverEventLoopMonitor") {}

export const ServerEventLoopMonitorLive = Layer.effect(
  ServerEventLoopMonitor,
  Effect.gen(function* () {
    const sampler = yield* Effect.acquireRelease(Effect.sync(makeEventLoopSampler), (s) =>
      Effect.sync(() => s.stop()),
    );
    let lastWarningAt = Number.NEGATIVE_INFINITY;
    let suppressedStalls = 0;
    let lastIdleGapLogAt = Number.NEGATIVE_INFINITY;
    const record = (outcome: SampleOutcome) => {
      if (outcome.kind === "steady") return Effect.void;
      const now = performance.now();
      if (outcome.kind === "idle-gap") {
        if (now - lastIdleGapLogAt < WINDOW_MS) return Effect.void;
        lastIdleGapLogAt = now;
        return Effect.logInfo("[server-event-loop] idle gap", { gapMs: outcome.durationMs });
      }
      if (now - lastWarningAt < WINDOW_MS) {
        suppressedStalls += 1;
        return Effect.void;
      }
      lastWarningAt = now;
      const memory = process.memoryUsage();
      const payload = {
        stallMs: outcome.durationMs,
        suppressedStalls,
        rssBytes: memory.rss,
        heapUsedBytes: memory.heapUsed,
      };
      suppressedStalls = 0;
      return Effect.logWarning("[server-event-loop] stall", payload);
    };
    yield* Effect.sync(() => sampler.sample()).pipe(
      Effect.flatMap(record),
      Effect.delay(SAMPLE_MS),
      Effect.forever,
      Effect.forkScoped,
    );
    return { status: Effect.sync(() => sampler.status()) };
  }),
);
