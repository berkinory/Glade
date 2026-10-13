import type { ProviderKind } from "@glade/contracts/core/baseSchemas";
import type {
  ServerProviderUsageLimit,
  ServerProviderUsageLine,
} from "@glade/contracts/server/server";
import { asFiniteNumber, asObjectRecord } from "@glade/shared/transport/payloadValues";
import { nonEmptyTrimmed } from "@glade/shared/text/text";

import { fetchJson } from "../http";
import {
  buildSnapshot,
  clampPercent,
  errorSnapshot,
  formatUsd,
  isoFromString,
  titleCase,
  unsupportedSnapshot,
} from "../parse";
import type { ProviderUsageFetcher } from "../types";

// OpenUsage (openusage.ai) is a local app that already reads each provider's limits from the
// user's own credentials and serves them read-only on loopback. Glade asks it for the providers it
// has no native usage reader for, using its stable `openusage.limits.v1` contract.
const OPEN_USAGE_ORIGIN = "http://127.0.0.1:6736";
const SOURCE = "openusage";
const REQUEST_TIMEOUT_MS = 3_000;

function resourceLabel(key: string): string {
  return titleCase(key.replace(/([a-z0-9])([A-Z])/gu, "$1 $2"));
}

function formatAmount(value: number, unit: string | undefined): string {
  if (unit === "usd") return formatUsd(value);
  const amount = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
  return unit && unit !== "percent" ? `${amount} ${unit}` : amount;
}

function mapResources(resources: Record<string, unknown>): {
  readonly limits: ServerProviderUsageLimit[];
  readonly usageLines: ServerProviderUsageLine[];
} {
  const limits: ServerProviderUsageLimit[] = [];
  const usageLines: ServerProviderUsageLine[] = [];
  for (const [key, raw] of Object.entries(resources)) {
    const resource = asObjectRecord(raw);
    if (!resource) continue;
    const unit = nonEmptyTrimmed(resource.unit);
    const label = resourceLabel(key);
    if (resource.kind === "balance") {
      const available = asFiniteNumber(resource.available);
      if (available !== undefined) {
        usageLines.push({ label, value: formatAmount(available, unit) });
      }
      continue;
    }
    const used = asFiniteNumber(resource.used);
    const limit = asFiniteNumber(resource.limit);
    const utilization = asFiniteNumber(resource.utilization);
    const usedPercent = clampPercent(
      utilization !== undefined
        ? utilization * 100
        : used !== undefined && limit !== undefined && limit > 0
          ? (used / limit) * 100
          : undefined,
    );
    if (usedPercent !== undefined) {
      const resetsAt = isoFromString(resource.resetsAt);
      const windowSeconds = asFiniteNumber(resource.windowSeconds);
      limits.push({
        window: label,
        limitId: key,
        usedPercent,
        ...(resetsAt ? { resetsAt } : {}),
        ...(windowSeconds !== undefined && windowSeconds > 0
          ? { windowDurationMins: Math.round(windowSeconds / 60) }
          : {}),
      });
    } else if (used !== undefined) {
      usageLines.push({ label, value: formatAmount(used, unit) });
    }
  }
  return { limits, usageLines };
}

export function makeOpenUsageFetcher(input: {
  readonly provider: ProviderKind;
  readonly displayName: string;
  readonly openUsageId: string;
}): ProviderUsageFetcher {
  const { provider, displayName, openUsageId } = input;
  return {
    provider,
    fetch: async (ctx) => {
      let response: Awaited<ReturnType<typeof fetchJson>>;
      try {
        response = await fetchJson({
          service: "openusage",
          url: `${OPEN_USAGE_ORIGIN}/v1/limits/${encodeURIComponent(openUsageId)}`,
          allowedOrigins: [OPEN_USAGE_ORIGIN],
          allowLoopbackHttp: true,
          timeoutMs: REQUEST_TIMEOUT_MS,
        });
      } catch {
        return unsupportedSnapshot(
          provider,
          ctx.nowMs,
          SOURCE,
          `${displayName} usage comes from OpenUsage (openusage.ai), which is not running.`,
        );
      }
      if (!response.ok) {
        return errorSnapshot(
          provider,
          ctx.nowMs,
          SOURCE,
          `OpenUsage could not report ${displayName} usage (HTTP ${response.status}).`,
        );
      }
      const envelope = asObjectRecord(response.json);
      const providers = asObjectRecord(envelope?.providers) ?? {};
      // A family id names every account of that provider; Glade shows one account per provider.
      const entry = asObjectRecord(providers[openUsageId] ?? Object.values(providers)[0]);
      if (!entry) {
        const failure = (Array.isArray(envelope?.errors) ? envelope.errors : [])
          .map((error) => asObjectRecord(error))
          .find((error) => nonEmptyTrimmed(error?.message));
        return failure
          ? errorSnapshot(provider, ctx.nowMs, SOURCE, nonEmptyTrimmed(failure.message)!)
          : unsupportedSnapshot(
              provider,
              ctx.nowMs,
              SOURCE,
              `OpenUsage has no ${displayName} usage yet. Turn ${displayName} on in OpenUsage.`,
            );
      }
      const { limits, usageLines } = mapResources(asObjectRecord(entry.resources) ?? {});
      const planName = nonEmptyTrimmed(entry.plan);
      return {
        ...buildSnapshot({
          provider,
          nowMs: ctx.nowMs,
          status: "ok",
          source: SOURCE,
          limits,
          usageLines,
          ...(planName ? { planName } : {}),
        }),
        ...(entry.stale === true ? { stale: true } : {}),
      };
    },
  };
}
