import nodePath from "node:path";

import type {
  ServerProviderUsageLimit,
  ServerProviderUsageLine,
} from "@glade/contracts/server/server";
import { asNumericValue, asObjectRecord } from "@glade/shared/transport/payloadValues";
import { nonEmptyTrimmed } from "@glade/shared/text/text";

import { grokHome } from "../../grok/grokEnvironment";
import { credentialFingerprint, jwtClaims, readJsonFile } from "../credentials";
import { fetchJson, isAuthFailureStatus } from "../http";
import {
  buildSnapshot,
  clampPercent,
  errorSnapshot,
  isoFromString,
  needsAuthSnapshot,
} from "../parse";
import type { ProviderUsageContext, ProviderUsageFetcher } from "../types";

const SOURCE = "grok-billing";
const API_ORIGIN = "https://cli-chat-proxy.grok.com";
// The same credits view the Grok CLI requests for its own usage display.
const CREDITS_URL = `${API_ORIGIN}/v1/billing?format=credits`;
const SETTINGS_URL = `${API_ORIGIN}/v1/settings`;
const WEEKLY_PERIOD_TYPE = "USAGE_PERIOD_TYPE_WEEKLY";
const EXPIRED_DETAIL =
  "Grok Build's sign-in has expired. Start a Grok Build chat to renew it, or run `grok login`.";

interface GrokLogin {
  readonly accessToken: string;
  readonly expiresAtMs: number | undefined;
}

// Grok rotates refresh tokens, so refreshing here would sign the CLI out; only the CLI renews them.
async function readGrokLogins(ctx: ProviderUsageContext): Promise<GrokLogin[]> {
  const auth = asObjectRecord(
    await readJsonFile(nodePath.join(grokHome(ctx.env, ctx.homeDir), "auth.json")),
  );
  return Object.values(auth ?? {}).flatMap((value) => {
    const entry = asObjectRecord(value);
    const accessToken = nonEmptyTrimmed(entry?.key);
    if (!accessToken) return [];
    const tokenExpiry = asNumericValue(jwtClaims(accessToken)?.exp);
    const storedExpiry = Date.parse(nonEmptyTrimmed(entry?.expires_at) ?? "");
    const expiresAtMs =
      tokenExpiry !== undefined
        ? tokenExpiry * 1000
        : Number.isFinite(storedExpiry)
          ? storedExpiry
          : undefined;
    return [{ accessToken, expiresAtMs }];
  });
}

function grokRequest(url: string, accessToken: string) {
  return fetchJson({
    service: "provider-usage-grok",
    url,
    allowedOrigins: [API_ORIGIN],
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "X-XAI-Token-Auth": "xai-grok-cli",
      Accept: "application/json",
    },
  });
}

// Proto-JSON drops zero values, so a missing percent or cap means 0.
function parseCredits(json: unknown): {
  readonly limits: ServerProviderUsageLimit[];
  readonly usageLines: ServerProviderUsageLine[];
} | null {
  const config = asObjectRecord(asObjectRecord(json)?.config);
  const period = asObjectRecord(config?.currentPeriod);
  const periodType = nonEmptyTrimmed(period?.type);
  const startsAt = isoFromString(period?.start);
  const resetsAt = isoFromString(period?.end);
  if (!config || !periodType || !startsAt || !resetsAt) return null;

  const limits: ServerProviderUsageLimit[] = [];
  // Accounts not yet on unified billing report a legacy monthly period with no weekly pool.
  if (periodType === WEEKLY_PERIOD_TYPE) {
    limits.push({
      window: "Weekly",
      limitId: "weekly",
      usedPercent: clampPercent(asNumericValue(config.creditUsagePercent) ?? 0) ?? 0,
      resetsAt,
      windowDurationMins: Math.round((Date.parse(resetsAt) - Date.parse(startsAt)) / 60_000),
    });
  }
  const cap = asNumericValue(asObjectRecord(config.onDemandCap)?.val) ?? 0;
  const capText = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(cap);
  return {
    limits,
    usageLines: [{ label: "Pay as you go", value: cap > 0 ? `${capText} credit cap` : "Off" }],
  };
}

async function fetchPlanName(accessToken: string): Promise<string | undefined> {
  try {
    const response = await grokRequest(SETTINGS_URL, accessToken);
    return response.ok
      ? nonEmptyTrimmed(asObjectRecord(response.json)?.subscription_tier_display)
      : undefined;
  } catch {
    return undefined;
  }
}

function isTeamPrincipal(status: number, json: unknown): boolean {
  const error = nonEmptyTrimmed(asObjectRecord(json)?.error);
  return status === 412 && error !== undefined && /no personal team/iu.test(error);
}

export const grokUsageFetcher: ProviderUsageFetcher = {
  provider: "grok",
  async cacheKey(ctx) {
    const logins = await readGrokLogins(ctx);
    return logins.length === 0
      ? `${ctx.homeDir}:none`
      : `${ctx.homeDir}:${logins.map((login) => credentialFingerprint(login.accessToken)).join("|")}`;
  },
  async fetch(ctx) {
    const logins = await readGrokLogins(ctx);
    if (logins.length === 0) return needsAuthSnapshot("grok", ctx.nowMs, SOURCE);

    for (const login of logins) {
      if (login.expiresAtMs !== undefined && login.expiresAtMs <= ctx.nowMs) {
        continue;
      }
      let response: Awaited<ReturnType<typeof fetchJson>>;
      try {
        response = await grokRequest(CREDITS_URL, login.accessToken);
      } catch {
        return errorSnapshot("grok", ctx.nowMs, SOURCE, "Could not reach Grok's billing service.");
      }
      if (isAuthFailureStatus(response.status)) continue;
      const planName = await fetchPlanName(login.accessToken);
      if (isTeamPrincipal(response.status, response.json)) {
        return buildSnapshot({
          provider: "grok",
          nowMs: ctx.nowMs,
          status: "unsupported",
          source: SOURCE,
          detail: "Grok team accounts have no personal usage quota.",
          ...(planName ? { planName } : {}),
        });
      }
      if (!response.ok) {
        return errorSnapshot(
          "grok",
          ctx.nowMs,
          SOURCE,
          `Grok billing request failed (HTTP ${response.status}).`,
        );
      }
      const credits = parseCredits(response.json);
      if (!credits) {
        return errorSnapshot("grok", ctx.nowMs, SOURCE, "Grok's billing response changed.");
      }
      return buildSnapshot({
        provider: "grok",
        nowMs: ctx.nowMs,
        status: "ok",
        source: SOURCE,
        ...credits,
        ...(planName ? { planName } : {}),
      });
    }
    return needsAuthSnapshot("grok", ctx.nowMs, SOURCE, EXPIRED_DETAIL);
  },
};
