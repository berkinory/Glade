import nodePath from "node:path";

import type { ServerProviderUsageSnapshot } from "@glade/contracts/server/server";
import { asObjectRecord } from "@glade/shared/transport/payloadValues";
import { nonEmptyTrimmed } from "@glade/shared/text/text";

import {
  credentialFingerprint,
  jwtClaims,
  readJsonFile,
  readKeychainPassword,
  readSqlite,
} from "../credentials";
import { fetchJson, isAuthFailureStatus } from "../http";
import {
  buildSnapshot,
  errorSnapshot,
  needsAuthSnapshot,
  titleCase,
  unsupportedSnapshot,
} from "../parse";
import type { ProviderUsageContext, ProviderUsageFetcher } from "../types";
import { mapCursorPlanUsage, mapCursorRequestUsage } from "./cursorUsage";

const SOURCE = "cursor-dashboard";
const API_ORIGIN = "https://api2.cursor.sh";
const WEB_ORIGIN = "https://cursor.com";
const DASHBOARD = `${API_ORIGIN}/aiserver.v1.DashboardService`;
const CLIENT_ID = "KbZUR41cY7W6zRSdpSUJ7I7mLYBKOCmB";
const KEYCHAIN_ACCOUNT = "cursor-user";
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

interface CursorLogin {
  readonly accessToken: string | undefined;
  readonly refreshToken: string | undefined;
}

class CursorSessionExpired extends Error {}

function configHome(ctx: ProviderUsageContext): string {
  if (ctx.platform === "darwin")
    return nodePath.join(ctx.homeDir, "Library", "Application Support");
  if (ctx.platform === "win32") {
    return ctx.env.APPDATA?.trim() || nodePath.join(ctx.homeDir, "AppData", "Roaming");
  }
  return ctx.env.XDG_CONFIG_HOME?.trim() || nodePath.join(ctx.homeDir, ".config");
}

// The Cursor CLI keeps its login in the macOS keychain and in auth.json elsewhere.
async function readCliLogin(ctx: ProviderUsageContext): Promise<CursorLogin | null> {
  if (ctx.platform === "darwin") {
    const [accessToken, refreshToken] = await Promise.all(
      ["cursor-access-token", "cursor-refresh-token"].map((service) =>
        readKeychainPassword({ service, account: KEYCHAIN_ACCOUNT, platform: ctx.platform }),
      ),
    );
    if (accessToken || refreshToken) {
      return { accessToken: accessToken ?? undefined, refreshToken: refreshToken ?? undefined };
    }
  }
  const authPath =
    ctx.platform === "darwin"
      ? nodePath.join(ctx.homeDir, ".cursor", "auth.json")
      : nodePath.join(configHome(ctx), ctx.platform === "win32" ? "Cursor" : "cursor", "auth.json");
  const auth = asObjectRecord(await readJsonFile(authPath));
  const accessToken = nonEmptyTrimmed(auth?.accessToken);
  const refreshToken = nonEmptyTrimmed(auth?.refreshToken);
  return accessToken || refreshToken ? { accessToken, refreshToken } : null;
}

function readEditorLogin(ctx: ProviderUsageContext): CursorLogin | null {
  const stateDb = nodePath.join(configHome(ctx), "Cursor", "User", "globalStorage", "state.vscdb");
  return readSqlite(stateDb, (db) => {
    const read = (key: string) =>
      nonEmptyTrimmed(db.prepare("SELECT value FROM ItemTable WHERE key = ?").get(key)?.value);
    const accessToken = read("cursorAuth/accessToken");
    const refreshToken = read("cursorAuth/refreshToken");
    return accessToken || refreshToken ? { accessToken, refreshToken } : null;
  });
}

async function readCursorLogin(ctx: ProviderUsageContext): Promise<CursorLogin | null> {
  return (await readCliLogin(ctx)) ?? readEditorLogin(ctx);
}

function expiresSoon(accessToken: string, nowMs: number): boolean {
  const exp = jwtClaims(accessToken)?.exp;
  return typeof exp === "number" && exp * 1000 <= nowMs + REFRESH_BUFFER_MS;
}

// Cursor keeps the refresh token on refresh, so the renewed access token can stay in memory
// without invalidating the login Cursor itself stores.
const refreshedAccessTokens = new Map<string, string>();

async function refreshAccessToken(refreshToken: string): Promise<string | undefined> {
  const response = await fetchJson({
    service: "provider-usage-cursor",
    url: `${API_ORIGIN}/oauth/token`,
    allowedOrigins: [API_ORIGIN],
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: { grant_type: "refresh_token", client_id: CLIENT_ID, refresh_token: refreshToken },
  });
  const body = asObjectRecord(response.json);
  if (body?.shouldLogout === true || response.status === 400 || response.status === 401) {
    throw new CursorSessionExpired();
  }
  const accessToken = response.ok ? nonEmptyTrimmed(body?.access_token) : undefined;
  if (accessToken) refreshedAccessTokens.set(credentialFingerprint(refreshToken), accessToken);
  return accessToken;
}

async function usableAccessToken(login: CursorLogin, nowMs: number): Promise<string | undefined> {
  const cached = login.refreshToken
    ? refreshedAccessTokens.get(credentialFingerprint(login.refreshToken))
    : undefined;
  const current = [cached, login.accessToken].find(
    (token): token is string => token !== undefined && !expiresSoon(token, nowMs),
  );
  if (current) return current;
  return login.refreshToken ? refreshAccessToken(login.refreshToken) : undefined;
}

function dashboardRequest(method: string, accessToken: string) {
  return fetchJson({
    service: "provider-usage-cursor",
    url: `${DASHBOARD}/${method}`,
    allowedOrigins: [API_ORIGIN],
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "Connect-Protocol-Version": "1",
    },
    body: {},
  });
}

async function fetchPlanName(accessToken: string): Promise<string | undefined> {
  try {
    const response = await dashboardRequest("GetPlanInfo", accessToken);
    const planName = response.ok
      ? nonEmptyTrimmed(asObjectRecord(asObjectRecord(response.json)?.planInfo)?.planName)
      : undefined;
    return planName ? titleCase(planName) : undefined;
  } catch {
    return undefined;
  }
}

// Request-based plans report a monthly request count on the web API, keyed by the token subject.
async function fetchRequestUsage(accessToken: string): Promise<unknown> {
  const subject = nonEmptyTrimmed(jwtClaims(accessToken)?.sub);
  const userId = subject?.split("|").at(-1);
  if (!userId) return null;
  try {
    const response = await fetchJson({
      service: "provider-usage-cursor",
      url: `${WEB_ORIGIN}/api/usage?user=${encodeURIComponent(userId)}`,
      allowedOrigins: [WEB_ORIGIN],
      headers: { Cookie: `WorkosCursorSessionToken=${userId}%3A%3A${accessToken}` },
    });
    return response.ok ? response.json : null;
  } catch {
    return null;
  }
}

async function fetchCursorUsage(
  login: CursorLogin,
  nowMs: number,
): Promise<ServerProviderUsageSnapshot> {
  let accessToken = await usableAccessToken(login, nowMs);
  if (!accessToken) return needsAuthSnapshot("cursor", nowMs, SOURCE);

  let response = await dashboardRequest("GetCurrentPeriodUsage", accessToken);
  if (isAuthFailureStatus(response.status) && login.refreshToken) {
    accessToken = await refreshAccessToken(login.refreshToken);
    if (!accessToken) return needsAuthSnapshot("cursor", nowMs, SOURCE);
    response = await dashboardRequest("GetCurrentPeriodUsage", accessToken);
  }
  if (isAuthFailureStatus(response.status)) return needsAuthSnapshot("cursor", nowMs, SOURCE);
  if (!response.ok) {
    return errorSnapshot(
      "cursor",
      nowMs,
      SOURCE,
      `Cursor usage request failed (HTTP ${response.status}).`,
    );
  }
  const usage = asObjectRecord(response.json);
  if (!usage) return errorSnapshot("cursor", nowMs, SOURCE, "Cursor's usage response changed.");

  const planName = await fetchPlanName(accessToken);
  const planUsage = mapCursorPlanUsage(usage, planName);
  if (!planUsage) {
    return unsupportedSnapshot("cursor", nowMs, SOURCE, "No active Cursor subscription.");
  }
  const requestUsage =
    planUsage.limits.length === 0
      ? mapCursorRequestUsage(await fetchRequestUsage(accessToken))
      : undefined;
  const limits = [...planUsage.limits, ...(requestUsage?.limits ?? [])];
  const usageLines = [...planUsage.usageLines, ...(requestUsage?.usageLines ?? [])];
  if (limits.length + usageLines.length === 0) {
    return unsupportedSnapshot(
      "cursor",
      nowMs,
      SOURCE,
      "Cursor did not report plan usage for this account.",
    );
  }
  return buildSnapshot({
    provider: "cursor",
    nowMs,
    status: "ok",
    source: SOURCE,
    limits,
    usageLines,
    ...(planName ? { planName } : {}),
  });
}

export const cursorUsageFetcher: ProviderUsageFetcher = {
  provider: "cursor",
  async cacheKey(ctx) {
    const login = await readCursorLogin(ctx);
    const identity = login?.refreshToken ?? login?.accessToken;
    return `${ctx.homeDir}:${identity ? credentialFingerprint(identity) : "none"}`;
  },
  async fetch(ctx) {
    const login = await readCursorLogin(ctx);
    if (!login) return needsAuthSnapshot("cursor", ctx.nowMs, SOURCE);
    try {
      return await fetchCursorUsage(login, ctx.nowMs);
    } catch (cause) {
      return cause instanceof CursorSessionExpired
        ? needsAuthSnapshot("cursor", ctx.nowMs, SOURCE)
        : errorSnapshot("cursor", ctx.nowMs, SOURCE, "Could not reach Cursor's usage service.");
    }
  },
};
