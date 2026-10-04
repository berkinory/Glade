import type {
  ServerCodexResetCredits,
  ServerProviderUsageLimit,
  ServerProviderUsageLine,
} from "@glade/contracts/server/server";
import { CodexAppServerManager } from "../../codex/codexAppServerManager";
import type { GetAccountRateLimitsResponse } from "../../codex/protocol/generated/types/v2/GetAccountRateLimitsResponse";
import type { RateLimitSnapshot } from "../../codex/protocol/generated/types/v2/RateLimitSnapshot";
import {
  buildSnapshot,
  errorSnapshot,
  isoFromUnixSeconds,
  needsAuthSnapshot,
  titleCase,
  unsupportedSnapshot,
} from "../parse";
import type { ProviderUsageFetcher } from "../types";

const SOURCE = "codex-app-server";

function usageLimits(response: GetAccountRateLimitsResponse): ServerProviderUsageLimit[] {
  const buckets = response.rateLimitsByLimitId;
  const entries: Array<[string, RateLimitSnapshot]> = buckets
    ? Object.entries(buckets).flatMap(([id, snapshot]) => (snapshot ? [[id, snapshot]] : []))
    : [[response.rateLimits.limitId ?? "codex", response.rateLimits]];
  return entries.flatMap(([id, snapshot]) => {
    const label = snapshot.limitName?.trim() || id;
    const limits: ServerProviderUsageLimit[] = [];
    for (const [name, window] of [
      ["5h", snapshot.primary],
      ["Weekly", snapshot.secondary],
    ] as const) {
      if (!window) continue;
      const usedPercent = Number.isFinite(window.usedPercent)
        ? Math.min(100, Math.max(0, window.usedPercent))
        : undefined;
      const resetsAt = isoFromUnixSeconds(window.resetsAt);
      const windowDurationMins = window.windowDurationMins;
      if (usedPercent === undefined && !resetsAt && windowDurationMins === null) continue;
      limits.push({
        window: `${label} ${name}`,
        limitId: id,
        ...(usedPercent !== undefined ? { usedPercent } : {}),
        ...(resetsAt ? { resetsAt } : {}),
        ...(windowDurationMins !== null &&
        Number.isInteger(windowDurationMins) &&
        windowDurationMins >= 0
          ? { windowDurationMins }
          : {}),
      });
    }
    return limits;
  });
}

function usageLines(response: GetAccountRateLimitsResponse): ServerProviderUsageLine[] {
  const credits = response.rateLimits.credits;
  const balance = credits?.balance === null ? null : Number(credits?.balance);
  return credits?.hasCredits && balance !== null && Number.isFinite(balance)
    ? [
        {
          label: "Credits",
          value: `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(balance)} remaining`,
        },
      ]
    : [];
}

function resetCredits(response: GetAccountRateLimitsResponse): ServerCodexResetCredits | undefined {
  const summary = response.rateLimitResetCredits;
  if (!summary) return undefined;
  const availableCount = Number(summary.availableCount);
  if (!Number.isSafeInteger(availableCount) || availableCount < 0) return undefined;
  return {
    availableCount,
    ...(response.accountId ? { accountId: response.accountId } : {}),
    ...(response.ordinaryUsageAllowed !== null ? { canUse: response.ordinaryUsageAllowed } : {}),
    ...(summary.credits === null
      ? {}
      : {
          credits: summary.credits.map((credit) => ({
            id: credit.id,
            status: credit.status,
            ...(isoFromUnixSeconds(credit.grantedAt)
              ? { grantedAt: isoFromUnixSeconds(credit.grantedAt) }
              : {}),
            ...(isoFromUnixSeconds(credit.expiresAt)
              ? { expiresAt: isoFromUnixSeconds(credit.expiresAt) }
              : {}),
            ...(credit.title?.trim() ? { title: credit.title.trim() } : {}),
            ...(credit.description?.trim() ? { description: credit.description.trim() } : {}),
          })),
        }),
  };
}

export const codexUsageFetcher: ProviderUsageFetcher = {
  provider: "codex",
  cacheKey: async () => null,
  async fetch(ctx) {
    const manager = new CodexAppServerManager();
    try {
      const homePath = ctx.codexHomePath?.trim() || ctx.env.CODEX_HOME?.trim();
      const providerOptions = {
        codex: {
          ...(ctx.codexBinaryPath ? { binaryPath: ctx.codexBinaryPath } : {}),
          ...(homePath ? { homePath } : {}),
        },
      };
      const account = await manager.readAccount({ cwd: ctx.homeDir, providerOptions });
      if (!account.account) return needsAuthSnapshot("codex", ctx.nowMs, SOURCE);
      if (account.account.type !== "chatgpt") {
        return unsupportedSnapshot(
          "codex",
          ctx.nowMs,
          SOURCE,
          "Account-wide limits are available for ChatGPT sign-in.",
        );
      }
      const rateLimits = await manager.readAccountRateLimits({ cwd: ctx.homeDir, providerOptions });
      const credits = resetCredits(rateLimits);
      return buildSnapshot({
        provider: "codex",
        nowMs: ctx.nowMs,
        status: "ok",
        source: SOURCE,
        limits: usageLimits(rateLimits),
        usageLines: usageLines(rateLimits),
        planName: titleCase(account.account.planType),
        ...(credits ? { resetCredits: credits } : {}),
      });
    } catch {
      return errorSnapshot("codex", ctx.nowMs, SOURCE, "Could not read Codex account usage.");
    } finally {
      await manager.stopAll();
    }
  },
};
