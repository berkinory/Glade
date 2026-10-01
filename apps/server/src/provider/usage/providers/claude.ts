import { asNumericValue } from "@glade/shared/transport/payloadValues";
import { nonEmptyTrimmed } from "@glade/shared/text/text";
import { asObjectRecord } from "@glade/shared/transport/payloadValues";
import nodePath from "node:path";
import { execProcessFileAsync } from "../../../platform/processRunner";

import type {
  ServerProviderUsageLimit,
  ServerProviderUsageLine,
  ServerProviderUsageSnapshot,
} from "@glade/contracts/server/server";

import { createLogger } from "../../../diagnostics/logger";
import { acquireClaudeAuthStatusLock } from "../../claude/claudeAuthStatusLock";
import { buildClaudeProcessEnv } from "../../claude/claudeProcessEnv";
import {
  credentialFingerprint,
  decodeKeychainJson,
  readJsonFile,
  readKeychainPassword,
} from "../credentials";
import { fetchJson, isAuthFailureStatus, isRateLimitStatus, parseRetryAfterMs } from "../http";
import {
  buildSnapshot,
  clampPercent,
  errorSnapshot,
  formatUsd,
  isoFromString,
  needsAuthSnapshot,
  titleCase,
} from "../parse";
import { createRateLimitResilience } from "../rateLimitResilience";
import type { ProviderUsageContext, ProviderUsageFetcher } from "../types";

const log = createLogger("provider-usage:claude");

const SOURCE = "claude-oauth-usage";
const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const KEYCHAIN_SERVICE = "Claude Code-credentials";
const REFRESH_BUFFER_MS = 5 * 60 * 1000;
const AUTH_NUDGE_TIMEOUT_MS = 20_000;

const AUTH_NUDGE_COOLDOWN_MS = 5 * 60 * 1000;
const SESSION_WINDOW_MINS = 5 * 60;
const WEEKLY_WINDOW_MINS = 7 * 24 * 60;

const LEGACY_MODEL_WEEKLY_WINDOWS: ReadonlyArray<readonly [label: string, key: string]> = [
  ["Fable", "seven_day_fable"],
  ["Sonnet", "seven_day_sonnet"],
  ["Opus", "seven_day_opus"],
];

type ClaudeCredSource = { kind: "file"; path: string } | { kind: "keychain" };

interface ClaudeCreds {
  accessToken: string;
  refreshToken: string | undefined;
  expiresAtMs: number | undefined;
  subscriptionType: string | undefined;
  rateLimitTier: string | undefined;
  scopes: ReadonlyArray<string>;
  source: ClaudeCredSource;
}

function readScopes(oauth: Record<string, unknown> | null): ReadonlyArray<string> {
  if (Array.isArray(oauth?.scopes)) {
    return oauth.scopes.filter((scope): scope is string => typeof scope === "string");
  }
  const scopeText = nonEmptyTrimmed(oauth?.scope);
  return scopeText ? scopeText.split(/\s+/u).filter((scope) => scope.length > 0) : [];
}

function readClaudeCreds(
  record: Record<string, unknown> | null,
  source: ClaudeCredSource,
): ClaudeCreds | null {
  const oauth = asObjectRecord(record?.claudeAiOauth);
  const accessToken = nonEmptyTrimmed(oauth?.accessToken);
  if (!accessToken) {
    return null;
  }
  return {
    accessToken,
    refreshToken: nonEmptyTrimmed(oauth?.refreshToken),
    expiresAtMs: asNumericValue(oauth?.expiresAt),
    subscriptionType: nonEmptyTrimmed(oauth?.subscriptionType),
    rateLimitTier: nonEmptyTrimmed(oauth?.rateLimitTier),
    scopes: readScopes(oauth),
    source,
  };
}

async function resolveClaudeCredCandidates(ctx: ProviderUsageContext): Promise<ClaudeCreds[]> {
  const candidates: ClaudeCreds[] = [];
  const paths: string[] = [];
  if (ctx.env.CLAUDE_CONFIG_DIR) {
    paths.push(nodePath.join(ctx.env.CLAUDE_CONFIG_DIR, ".credentials.json"));
  }
  paths.push(nodePath.join(ctx.homeDir, ".claude", ".credentials.json"));

  for (const path of paths) {
    const record = asObjectRecord(await readJsonFile(path));
    const creds = readClaudeCreds(record, { kind: "file", path });
    if (creds) {
      candidates.push(creds);
    }
  }

  const keychainAccount = nonEmptyTrimmed(ctx.env.USER) ?? nonEmptyTrimmed(ctx.env.LOGNAME);
  const accountKeychain =
    keychainAccount === undefined
      ? null
      : await readKeychainPassword({
          service: KEYCHAIN_SERVICE,
          account: keychainAccount,
          platform: ctx.platform,
        });
  const keychain =
    accountKeychain ??
    (await readKeychainPassword({
      service: KEYCHAIN_SERVICE,
      platform: ctx.platform,
    }));
  if (keychain) {
    const creds = readClaudeCreds(asObjectRecord(decodeKeychainJson(keychain)), {
      kind: "keychain",
    });
    if (creds) {
      candidates.push(creds);
    }
  }
  return candidates;
}

function sameCredSource(a: ClaudeCredSource, b: ClaudeCredSource): boolean {
  if (a.kind === "file" && b.kind === "file") {
    return a.path === b.path;
  }
  return a.kind === "keychain" && b.kind === "keychain";
}

function hasProfileScope(creds: ClaudeCreds): boolean {
  return creds.scopes.length === 0 || creds.scopes.includes("user:profile");
}

function isStaleClaudeCreds(creds: ClaudeCreds, nowMs: number): boolean {
  return creds.expiresAtMs !== undefined && creds.expiresAtMs <= nowMs + REFRESH_BUFFER_MS;
}

function claudePlanName(creds: ClaudeCreds): string | undefined {
  if (!creds.subscriptionType) {
    return undefined;
  }
  let name = titleCase(creds.subscriptionType);
  const tier = creds.rateLimitTier?.match(/(\d+x)/iu)?.[1];
  if (tier) {
    name += ` (${tier.toLowerCase()})`;
  }
  return name;
}

function claudeCredentialCacheKey(ctx: ProviderUsageContext, creds: ClaudeCreds): string {
  const stableSecret = creds.refreshToken ?? creds.accessToken;
  return `${ctx.homeDir}:${credentialFingerprint(stableSecret)}`;
}

function claudeCredentialsCacheKey(
  ctx: ProviderUsageContext,
  credentials: ReadonlyArray<ClaudeCreds>,
): string {
  if (credentials.length === 0) {
    return `${ctx.homeDir}:none`;
  }
  return credentials.map((creds) => claudeCredentialCacheKey(ctx, creds)).join("|");
}

interface ClaudeAuthNudgeDeps {
  acquireLock: () => Promise<() => void>;
  runAuthStatus: (input: {
    binaryPath: string;
    homeDir: string;
    env: NodeJS.ProcessEnv;
  }) => Promise<void>;
}

const defaultAuthNudgeDeps: ClaudeAuthNudgeDeps = {
  acquireLock: acquireClaudeAuthStatusLock,
  async runAuthStatus(input) {
    await execProcessFileAsync(input.binaryPath, ["auth", "status"], {
      timeout: AUTH_NUDGE_TIMEOUT_MS,
      env: buildClaudeProcessEnv({
        env: input.env,
        ...(input.homeDir ? { homeDir: input.homeDir } : {}),
      }),
    });
  },
};

let authNudgeDeps: ClaudeAuthNudgeDeps = defaultAuthNudgeDeps;
const authNudgeNotBeforeMs = new Map<string, number>();

function authNudgeKey(ctx: ProviderUsageContext): string {
  return `${ctx.homeDir}:${ctx.env.CLAUDE_CONFIG_DIR ?? ""}`;
}

async function nudgeClaudeCliAuthRefresh(ctx: ProviderUsageContext): Promise<boolean> {
  const key = authNudgeKey(ctx);
  const notBefore = authNudgeNotBeforeMs.get(key) ?? 0;
  if (ctx.nowMs < notBefore) {
    return false;
  }
  authNudgeNotBeforeMs.set(key, ctx.nowMs + AUTH_NUDGE_COOLDOWN_MS);
  const release = await authNudgeDeps.acquireLock();
  try {
    await authNudgeDeps.runAuthStatus({
      binaryPath: ctx.claudeBinaryPath?.trim() || "claude",
      homeDir: ctx.homeDir,
      env: ctx.env,
    });
    return true;
  } catch (cause) {
    log.warn("claude auth status nudge failed; using stored credentials as-is", {
      message: cause instanceof Error ? cause.message : String(cause),
    });
    return true;
  } finally {
    release();
  }
}

function parseClaudeUsage(input: { json: unknown; nowMs: number; planName?: string }) {
  const root = asObjectRecord(input.json);
  const limits: ServerProviderUsageLimit[] = [];
  const usageLines: ServerProviderUsageLine[] = [];

  const pushLimit = (
    label: string,
    percent: number | undefined,
    resetsAtValue: unknown,
    windowDurationMins: number,
  ): void => {
    const usedPercent = clampPercent(percent);
    const resetsAt = isoFromString(resetsAtValue);
    if (usedPercent === undefined && !resetsAt) {
      return;
    }
    limits.push({
      window: label,
      ...(usedPercent !== undefined ? { usedPercent } : {}),
      ...(resetsAt ? { resetsAt } : {}),
      windowDurationMins,
    });
  };

  const pushWindow = (label: string, windowValue: unknown, windowDurationMins: number): void => {
    const window = asObjectRecord(windowValue);
    if (!window) {
      return;
    }
    pushLimit(label, asNumericValue(window.utilization), window.resets_at, windowDurationMins);
  };

  pushWindow("5h", root?.five_hour, SESSION_WINDOW_MINS);
  pushWindow("Weekly", root?.seven_day, WEEKLY_WINDOW_MINS);

  const scopedLabels = new Set<string>();
  for (const entry of Array.isArray(root?.limits) ? root.limits : []) {
    const scoped = asObjectRecord(entry);
    if (scoped?.kind !== "weekly_scoped") {
      continue;
    }
    const label = nonEmptyTrimmed(
      asObjectRecord(asObjectRecord(scoped.scope)?.model)?.display_name,
    )?.trim();
    if (!label || scopedLabels.has(label)) {
      continue;
    }
    scopedLabels.add(label);
    pushLimit(label, asNumericValue(scoped.percent), scoped.resets_at, WEEKLY_WINDOW_MINS);
  }
  for (const [label, key] of LEGACY_MODEL_WEEKLY_WINDOWS) {
    if (!scopedLabels.has(label)) {
      pushWindow(label, root?.[key], WEEKLY_WINDOW_MINS);
    }
  }

  const extra = asObjectRecord(root?.extra_usage);
  if (extra && extra.is_enabled !== false) {
    const usedCredits = asNumericValue(extra.used_credits);
    const monthlyLimit = asNumericValue(extra.monthly_limit);
    if (usedCredits !== undefined) {
      const usedUsd = formatUsd(usedCredits / 100);
      const value =
        monthlyLimit && monthlyLimit > 0
          ? `${usedUsd} of ${formatUsd(monthlyLimit / 100)}`
          : `${usedUsd} spent`;
      usageLines.push({ label: "Extra usage", value });
    }
  }

  return buildSnapshot({
    provider: "claudeAgent",
    nowMs: input.nowMs,
    status: "ok",
    source: SOURCE,
    limits,
    usageLines,
    ...(input.planName ? { planName: input.planName } : {}),
  });
}

const claudeRateLimit = createRateLimitResilience({
  provider: "claudeAgent",
  source: SOURCE,
  detail: (retryMins) =>
    `Anthropic is rate-limiting usage checks — showing your last values, retrying in ~${retryMins}m. Manual refreshes only extend the limit.`,
});

export const claudeUsageFetcher: ProviderUsageFetcher = {
  provider: "claudeAgent",
  async cacheKey(ctx) {
    return claudeCredentialsCacheKey(ctx, await resolveClaudeCredCandidates(ctx));
  },
  async fetch(ctx) {
    const candidates = await resolveClaudeCredCandidates(ctx);
    if (candidates.length === 0) {
      return needsAuthSnapshot("claudeAgent", ctx.nowMs, SOURCE);
    }

    let nudgedCandidates: ReadonlyArray<ClaudeCreds> | null | undefined;
    const nudgeOnce = async (): Promise<ReadonlyArray<ClaudeCreds> | null> => {
      if (nudgedCandidates !== undefined) {
        return nudgedCandidates;
      }
      nudgedCandidates = (await nudgeClaudeCliAuthRefresh(ctx))
        ? await resolveClaudeCredCandidates(ctx)
        : null;
      return nudgedCandidates;
    };

    let inferenceOnlySnapshot: ReturnType<typeof buildSnapshot> | null = null;
    let lastErrorSnapshot: ServerProviderUsageSnapshot | null = null;

    for (const original of candidates) {
      if (!hasProfileScope(original)) {
        const planName = claudePlanName(original);
        inferenceOnlySnapshot = buildSnapshot({
          provider: "claudeAgent",
          nowMs: ctx.nowMs,
          status: "ok",
          source: SOURCE,
          ...(planName ? { planName } : {}),
        });
        continue;
      }

      let activeCreds = original;
      if (isStaleClaudeCreds(activeCreds, ctx.nowMs)) {
        const refreshed = await nudgeOnce();
        const updated = refreshed?.find((creds) => sameCredSource(creds.source, original.source));
        if (updated) {
          activeCreds = updated;
        }
        if (activeCreds.expiresAtMs !== undefined && activeCreds.expiresAtMs <= ctx.nowMs) {
          continue;
        }
      }

      const rateLimitKey = claudeCredentialCacheKey(ctx, activeCreds);
      const cooldownSnapshot = claudeRateLimit.serveDuringCooldown(rateLimitKey, ctx.nowMs);
      if (cooldownSnapshot) {
        return cooldownSnapshot;
      }

      try {
        let result = await fetchClaudeUsage(activeCreds.accessToken);
        if (isAuthFailureStatus(result.status)) {
          const refreshed = await nudgeOnce();
          const updated = refreshed?.find((creds) => sameCredSource(creds.source, original.source));
          if (updated && updated.accessToken !== activeCreds.accessToken) {
            activeCreds = updated;
            result = await fetchClaudeUsage(activeCreds.accessToken);
          }
        }
        if (isAuthFailureStatus(result.status)) {
          log.warn("claude usage request unauthorized after CLI refresh; trying next source", {
            status: result.status,
            source: activeCreds.source.kind,
          });
          continue;
        }
        if (isRateLimitStatus(result.status)) {
          return claudeRateLimit.enterCooldown(
            claudeCredentialCacheKey(ctx, activeCreds),
            ctx.nowMs,
            parseRetryAfterMs(result.headers, ctx.nowMs),
          );
        }
        if (!result.ok) {
          log.warn("claude usage request failed", { status: result.status });
          lastErrorSnapshot = errorSnapshot(
            "claudeAgent",
            ctx.nowMs,
            SOURCE,
            `Claude usage request failed (${result.status}).`,
          );
          continue;
        }
        const planName = claudePlanName(activeCreds);
        const snapshot = parseClaudeUsage({
          json: result.json,
          nowMs: ctx.nowMs,
          ...(planName ? { planName } : {}),
        });
        claudeRateLimit.rememberLastGood(
          claudeCredentialCacheKey(ctx, activeCreds),
          snapshot,
          ctx.nowMs,
        );
        return snapshot;
      } catch (cause) {
        log.warn("claude usage endpoint unreachable", {
          message: cause instanceof Error ? cause.message : String(cause),
        });
        lastErrorSnapshot = errorSnapshot(
          "claudeAgent",
          ctx.nowMs,
          SOURCE,
          "Could not reach the Claude usage endpoint.",
        );
        continue;
      }
    }

    return (
      inferenceOnlySnapshot ??
      lastErrorSnapshot ??
      needsAuthSnapshot("claudeAgent", ctx.nowMs, SOURCE)
    );
  },
};

function fetchClaudeUsage(accessToken: string) {
  return fetchJson({
    service: "provider-usage-claude",
    url: USAGE_URL,
    allowedOrigins: [new URL(USAGE_URL).origin],
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "anthropic-beta": "oauth-2025-04-20",
      "User-Agent": "claude-code/2.1.69",
    },
  });
}
