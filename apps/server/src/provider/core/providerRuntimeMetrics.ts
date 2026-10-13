import type { ProviderKind } from "@glade/contracts/core/baseSchemas";
import type { ProviderRuntimeEvent } from "@glade/contracts/provider/runtimeEvents";
import type {
  ServerDiagnosticsLatency,
  ServerDiagnosticsProviderRuntime,
} from "@glade/contracts/server/server";

const SAMPLE_CAPACITY = 256;
const PENDING_TURN_CAPACITY = 256;

export interface ProviderRuntimeMetrics {
  readonly observe: (event: ProviderRuntimeEvent, publishedAtMs: number) => void;
  readonly snapshot: () => ReadonlyArray<ServerDiagnosticsProviderRuntime>;
}

interface LatencySamples {
  readonly add: (value: number) => void;
  readonly summary: () => ServerDiagnosticsLatency;
}

function makeLatencySamples(): LatencySamples {
  const samples: number[] = [];
  let next = 0;
  return {
    add(value) {
      if (!Number.isFinite(value) || value < 0) return;
      if (samples.length < SAMPLE_CAPACITY) samples.push(value);
      else samples[next] = value;
      next = (next + 1) % SAMPLE_CAPACITY;
    },
    summary() {
      if (samples.length === 0) return { count: 0 };
      const sorted = samples.toSorted((left, right) => left - right);
      const at = (quantile: number) =>
        Math.round(sorted[Math.min(sorted.length - 1, Math.floor(quantile * sorted.length))]!);
      return {
        count: sorted.length,
        p50Ms: at(0.5),
        p95Ms: at(0.95),
        maxMs: Math.round(sorted.at(-1)!),
      };
    },
  };
}

// Time to first token runs from the adapter's turn.started to its first content delta of that turn,
// both stamped by the adapter. Publish latency runs from the adapter's stamp to the moment the event
// is journaled and published, so it includes delta batching.
export function makeProviderRuntimeMetrics(): ProviderRuntimeMetrics {
  const byProvider = new Map<
    ProviderKind,
    { readonly timeToFirstToken: LatencySamples; readonly publishLatency: LatencySamples }
  >();
  const turnStartedAtMs = new Map<string, number>();

  const metricsFor = (provider: ProviderKind) => {
    let metrics = byProvider.get(provider);
    if (metrics === undefined) {
      metrics = { timeToFirstToken: makeLatencySamples(), publishLatency: makeLatencySamples() };
      byProvider.set(provider, metrics);
    }
    return metrics;
  };

  return {
    observe(event, publishedAtMs) {
      const metrics = metricsFor(event.provider);
      const createdAtMs = Date.parse(event.createdAt);
      metrics.publishLatency.add(publishedAtMs - createdAtMs);
      if (event.turnId === undefined) return;
      const turnKey = `${event.threadId}\u0000${event.turnId}`;
      switch (event.type) {
        case "turn.started":
          turnStartedAtMs.delete(turnKey);
          turnStartedAtMs.set(turnKey, createdAtMs);
          if (turnStartedAtMs.size > PENDING_TURN_CAPACITY) {
            turnStartedAtMs.delete(turnStartedAtMs.keys().next().value!);
          }
          return;
        case "content.delta": {
          const startedAtMs = turnStartedAtMs.get(turnKey);
          if (startedAtMs === undefined) return;
          turnStartedAtMs.delete(turnKey);
          metrics.timeToFirstToken.add(createdAtMs - startedAtMs);
          return;
        }
        case "turn.completed":
        case "turn.aborted":
          turnStartedAtMs.delete(turnKey);
          return;
        default:
          return;
      }
    },
    snapshot: () =>
      [...byProvider].map(([provider, metrics]) => ({
        provider,
        timeToFirstTokenMs: metrics.timeToFirstToken.summary(),
        eventPublishLatencyMs: metrics.publishLatency.summary(),
      })),
  };
}
