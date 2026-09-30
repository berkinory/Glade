import { asObjectRecord } from "@glade/shared/transport/payloadValues";
import nodePath from "node:path";

import type {
  ServerProviderUsageLimit,
  ServerProviderUsageLine,
} from "@glade/contracts/server/server";

import { createLogger } from "../../logger";
import { fetchCodexResetCredits } from "../codexResetCredits";
import {
  credentialFingerprint,
  decodeJwtExpMs,
  decodeKeychainJson,
  readJsonFile,
  readKeychainPassword,
  refreshOAuthAccessToken,
  writeJsonFileAtomic,
  type OAuthRefreshResult,
} from "../credentials";
import { fetchJson, isAuthFailureStatus } from "../http";
import {
  asFiniteNumber,
  asString,
  buildSnapshot,
  clampPercent,
  errorSnapshot,
  formatUsd,
  isoFromUnixSeconds,
  needsAuthSnapshot,
  titleCase,
  unsupportedSnapshot,
} from "../parse";
import type { ProviderUsageContext, ProviderUsageFetcher } from "../types";

const log = createLogger("provider-usage:codex");

const SOURCE = "codex-wham-usage";
const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const REFRESH_URL = "https://auth.openai.com/oauth/token";
const OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const KEYCHAIN_SERVICE = "Codex Auth";

const ACCESS_TOKEN_REFRESH_WINDOW_MS = 5 * 60 * 1000;
// Fallback for tokens without a readable `exp`: the CLI treats a login as stale after 8 days.
const LAST_REFRESH_MAX_AGE_MS = 8 * 24 * 60 * 60 * 1000;

const REFRESH_TOKEN_DEAD_CODES = new Set(["refresh_token_expired", "refresh_token_invalidated"]);

const REFRESH_TOKEN_REUSED_CODE = "refresh_token_reused";

type CodexAuthSource = { kind: "file"; path: string } | { kind: "keychain" };

interface CodexOAuthState {
  kind: "oauth";

  record: Record<string, unknown>;
  accessToken: string;
  refreshToken: string | undefined;
  accountId: string | undefined;
  source: CodexAuthSource;
}

type CodexAuth = CodexOAuthState | { kind: "api-key" };

function authFilePaths(ctx: ProviderUsageContext): string[] {
  const paths: string[] = [];
  const push = (value: string) => {
    if (!paths.includes(value)) paths.push(value);
  };
  if (ctx.env.CODEX_HOME) {
    push(nodePath.join(ctx.env.CODEX_HOME, "auth.json"));
  }
  const configHome = ctx.env.XDG_CONFIG_HOME?.trim();
  if (configHome) {
    push(nodePath.join(configHome, "codex", "auth.json"));
  }
  push(nodePath.join(ctx.homeDir, ".config", "codex", "auth.json"));
  push(nodePath.join(ctx.homeDir, ".codex", "auth.json"));
  return paths;
}

function readCodexAuthRecord(
  record: Record<string, unknown> | null,
  source: CodexAuthSource,
): CodexAuth | "api-key-only" | null {
  if (!record) {
    return null;
  }
  const tokens = asObjectRecord(record.tokens);
  const accessToken = asString(tokens?.access_token);
  if (accessToken) {
    return {
      kind: "oauth",
      record,
      accessToken,
      refreshToken: asString(tokens?.refresh_token),
      accountId: asString(tokens?.account_id),
      source,
    };
  }
  return asString(record.OPENAI_API_KEY) ? "api-key-only" : null;
}

async function reloadCodexAuth(
  ctx: ProviderUsageContext,
  source: CodexAuthSource,
): Promise<CodexOAuthState | null> {
  const record =
    source.kind === "file"
      ? asObjectRecord(await readJsonFile(source.path))
      : asObjectRecord(
          decodeKeychainJson(
            (await readKeychainPassword({ service: KEYCHAIN_SERVICE, platform: ctx.platform })) ??
              "",
          ),
        );
  const parsed = readCodexAuthRecord(record, source);
  return parsed && parsed !== "api-key-only" && parsed.kind === "oauth" ? parsed : null;
}

async function resolveCodexAuth(ctx: ProviderUsageContext): Promise<CodexAuth | null> {
  let sawApiKeyOnly = false;

  for (const path of authFilePaths(ctx)) {
    const parsed = readCodexAuthRecord(asObjectRecord(await readJsonFile(path)), {
      kind: "file",
      path,
    });
    if (parsed && parsed !== "api-key-only") {
      return parsed;
    }
    if (parsed === "api-key-only") {
      sawApiKeyOnly = true;
    }
  }

  const keychain = await readKeychainPassword({
    service: KEYCHAIN_SERVICE,
    platform: ctx.platform,
  });
  if (keychain) {
    const parsed = readCodexAuthRecord(asObjectRecord(decodeKeychainJson(keychain)), {
      kind: "keychain",
    });
    if (parsed && parsed !== "api-key-only") {
      return parsed;
    }
    if (parsed === "api-key-only") {
      sawApiKeyOnly = true;
    }
  }

  return sawApiKeyOnly ? { kind: "api-key" } : null;
}

function codexAuthCacheKey(ctx: ProviderUsageContext, auth: CodexAuth | null): string {
  if (!auth) {
    return `${ctx.homeDir}:none`;
  }
  if (auth.kind === "api-key") {
    return `${ctx.homeDir}:api-key`;
  }
  const stableIdentity = auth.accountId ?? auth.refreshToken ?? auth.accessToken;
  return `${ctx.homeDir}:${credentialFingerprint(stableIdentity)}`;
}

function codexAuthNeedsRefresh(state: CodexOAuthState, nowMs: number): boolean {
  const expMs = decodeJwtExpMs(state.accessToken);
  if (expMs !== null) {
    return expMs - nowMs <= ACCESS_TOKEN_REFRESH_WINDOW_MS;
  }
  const lastRefresh = asString(state.record.last_refresh);
  const lastRefreshMs = lastRefresh ? Date.parse(lastRefresh) : Number.NaN;
  return Number.isFinite(lastRefreshMs) && nowMs - lastRefreshMs > LAST_REFRESH_MAX_AGE_MS;
}

// Serializes refresh attempts per auth.json path within this process, so concurrent usage fetches
// can't race each other into redeeming the same single-use refresh token twice.
const refreshLocks = new Map<string, Promise<unknown>>();
function withRefreshLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = refreshLocks.get(key) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  refreshLocks.set(
    key,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}

async function persistRotatedCodexAuth(
  state: CodexOAuthState,
  refreshed: Extract<OAuthRefreshResult, { ok: true }>,
  nowMs: number,
): Promise<CodexOAuthState> {
  const tokens: Record<string, unknown> = {
    ...asObjectRecord(state.record.tokens),
    access_token: refreshed.accessToken,
  };
  if (refreshed.refreshToken) {
    tokens.refresh_token = refreshed.refreshToken;
  }
  if (refreshed.idToken) {
    tokens.id_token = refreshed.idToken;
  }
  const record: Record<string, unknown> = {
    ...state.record,
    tokens,
    last_refresh: new Date(nowMs).toISOString(),
  };
  if (state.source.kind === "file") {
    try {
      await writeJsonFileAtomic(state.source.path, record);
    } catch (cause) {
      log.error(
        "failed to persist rotated codex credentials; the CLI may need a re-login if the old refresh token is gone",
        { message: cause instanceof Error ? cause.message : String(cause) },
      );
    }
  }
  return {
    ...state,
    record,
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken ?? state.refreshToken,
  };
}

type CodexRefreshOutcome =
  | { kind: "updated"; state: CodexOAuthState; redeemed: boolean }
  | { kind: "needs-auth" }
  | { kind: "unavailable" };

async function refreshCodexAuth(
  ctx: ProviderUsageContext,
  state: CodexOAuthState,
  options: { allowRedeem: boolean },
): Promise<CodexRefreshOutcome> {
  if (state.source.kind === "keychain") {
    const live = await reloadCodexAuth(ctx, state.source);
    return live && live.accessToken !== state.accessToken
      ? { kind: "updated", state: live, redeemed: false }
      : { kind: "unavailable" };
  }

  const path = state.source.path;
  return withRefreshLock(path, async () => {
    const live = (await reloadCodexAuth(ctx, state.source)) ?? state;
    if (live.accessToken !== state.accessToken && !codexAuthNeedsRefresh(live, ctx.nowMs)) {
      return { kind: "updated", state: live, redeemed: false };
    }
    if (!options.allowRedeem) {
      return live.accessToken !== state.accessToken
        ? { kind: "updated", state: live, redeemed: false }
        : { kind: "needs-auth" };
    }
    if (!live.refreshToken) {
      return { kind: "needs-auth" };
    }

    const refreshed = await refreshOAuthAccessToken({
      service: "provider-usage-codex-refresh",
      refreshUrl: REFRESH_URL,
      allowedOrigins: [new URL(REFRESH_URL).origin],
      refreshToken: live.refreshToken,
      clientId: OAUTH_CLIENT_ID,
      bodyFormat: "form",
    });
    if (refreshed.ok) {
      return {
        kind: "updated",
        state: await persistRotatedCodexAuth(live, refreshed, ctx.nowMs),
        redeemed: true,
      };
    }
    if (refreshed.errorCode === REFRESH_TOKEN_REUSED_CODE) {
      // Someone else (the CLI, another process) won the redemption race; their rotation should already be
      // on disk — pick it up instead of declaring the login dead.
      const rotated = await reloadCodexAuth(ctx, state.source);
      if (rotated && rotated.accessToken !== live.accessToken) {
        return { kind: "updated", state: rotated, redeemed: false };
      }
      log.warn("codex refresh token already redeemed and no rotated credential found on disk");
      return { kind: "needs-auth" };
    }
    if (refreshed.errorCode && REFRESH_TOKEN_DEAD_CODES.has(refreshed.errorCode)) {
      log.warn("codex refresh token rejected; re-login required", {
        errorCode: refreshed.errorCode,
      });
      return { kind: "needs-auth" };
    }

    log.warn(
      "codex token refresh unavailable; continuing with the stored access token",
      refreshed.status !== undefined ? { status: refreshed.status } : {},
    );
    return { kind: "unavailable" };
  });
}

function resetFromWindow(
  window: Record<string, unknown> | null,
  nowMs: number,
): string | undefined {
  const explicit = isoFromUnixSeconds(window?.reset_at);
  if (explicit) {
    return explicit;
  }
  const after = asFiniteNumber(window?.reset_after_seconds);
  if (after !== undefined && after > 0) {
    return new Date(nowMs + after * 1000).toISOString();
  }
  return undefined;
}

function parseCodexUsage(input: {
  json: unknown;
  headers?: Record<string, string>;
  nowMs: number;
}) {
  const root = asObjectRecord(input.json);
  const headers = input.headers ?? {};
  const rateLimit = asObjectRecord(root?.rate_limit);
  const limits: ServerProviderUsageLimit[] = [];
  const usageLines: ServerProviderUsageLine[] = [];

  const pushWindow = (
    label: string,
    windowValue: unknown,
    headerName: string,
    fallbackDurationMins: number,
  ): void => {
    const window = asObjectRecord(windowValue);
    if (!window) {
      return;
    }
    const usedPercent =
      clampPercent(asFiniteNumber(headers[headerName])) ??
      clampPercent(asFiniteNumber(window.used_percent));
    const resetsAt = resetFromWindow(window, input.nowMs);
    const windowSeconds = asFiniteNumber(window.limit_window_seconds);
    const windowDurationMins =
      windowSeconds !== undefined ? Math.round(windowSeconds / 60) : fallbackDurationMins;
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

  pushWindow("5h", rateLimit?.primary_window, "x-codex-primary-used-percent", 300);
  pushWindow("Weekly", rateLimit?.secondary_window, "x-codex-secondary-used-percent", 10_080);

  const credits = asObjectRecord(root?.credits);
  const balance =
    asFiniteNumber(headers["x-codex-credits-balance"]) ?? asFiniteNumber(credits?.balance);
  if (balance !== undefined && (credits?.has_credits !== false || balance > 0)) {
    usageLines.push({ label: "Credits", value: `${formatUsd(balance)} remaining` });
  }

  const planType = asString(root?.plan_type);
  return buildSnapshot({
    provider: "codex",
    nowMs: input.nowMs,
    status: "ok",
    source: SOURCE,
    limits,
    usageLines,
    ...(planType ? { planName: titleCase(planType) } : {}),
  });
}

function fetchCodexUsage(state: CodexOAuthState) {
  return fetchJson({
    service: "provider-usage-codex",
    url: USAGE_URL,
    allowedOrigins: [new URL(USAGE_URL).origin],
    headers: {
      Authorization: `Bearer ${state.accessToken}`,
      Accept: "application/json",
      "User-Agent": "Glade",
      ...(state.accountId ? { "ChatGPT-Account-Id": state.accountId } : {}),
    },
  });
}

export const codexUsageFetcher: ProviderUsageFetcher = {
  provider: "codex",
  async cacheKey(ctx) {
    return codexAuthCacheKey(ctx, await resolveCodexAuth(ctx));
  },
  async fetch(ctx) {
    const auth = await resolveCodexAuth(ctx);
    if (!auth) {
      return needsAuthSnapshot("codex", ctx.nowMs, SOURCE);
    }
    if (auth.kind === "api-key") {
      return unsupportedSnapshot(
        "codex",
        ctx.nowMs,
        SOURCE,
        "Codex API-key auth has no usage endpoint. Sign in with ChatGPT to see usage.",
      );
    }

    let state = auth;

    let allowRedeem = true;

    if (codexAuthNeedsRefresh(state, ctx.nowMs)) {
      const outcome = await refreshCodexAuth(ctx, state, { allowRedeem });
      if (outcome.kind === "needs-auth") {
        return needsAuthSnapshot("codex", ctx.nowMs, SOURCE);
      }
      if (outcome.kind === "updated") {
        allowRedeem = allowRedeem && !outcome.redeemed;
        state = outcome.state;
      }
    }

    try {
      let result = await fetchCodexUsage(state);
      if (isAuthFailureStatus(result.status)) {
        const outcome = await refreshCodexAuth(ctx, state, { allowRedeem });
        if (outcome.kind === "updated" && outcome.state.accessToken !== state.accessToken) {
          state = outcome.state;
          result = await fetchCodexUsage(state);
        }
      }
      if (isAuthFailureStatus(result.status)) {
        log.warn("codex usage request unauthorized after refresh", { status: result.status });
        return needsAuthSnapshot("codex", ctx.nowMs, SOURCE);
      }
      if (!result.ok) {
        log.warn("codex usage request failed", { status: result.status });
        return errorSnapshot(
          "codex",
          ctx.nowMs,
          SOURCE,
          `Codex usage request failed (${result.status}).`,
        );
      }
      const snapshot = parseCodexUsage({
        json: result.json,
        headers: Object.fromEntries(result.headers),
        nowMs: ctx.nowMs,
      });

      const resetCredits = await fetchCodexResetCredits({
        binaryPath: ctx.codexBinaryPath,
        expectedAccountId: state.accountId,
        env: ctx.env,
        cwd: ctx.homeDir,
      });
      return resetCredits ? { ...snapshot, resetCredits } : snapshot;
    } catch (cause) {
      log.warn("codex usage endpoint unreachable", {
        message: cause instanceof Error ? cause.message : String(cause),
      });
      return errorSnapshot("codex", ctx.nowMs, SOURCE, "Could not reach the Codex usage endpoint.");
    }
  },
};
