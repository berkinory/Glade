import fs from "node:fs/promises";
import nodePath from "node:path";

import type { ServerProviderUsageLimit } from "@glade/contracts/server/server";
import { asNumericValue, asObjectRecord } from "@glade/shared/transport/payloadValues";
import { nonEmptyTrimmed } from "@glade/shared/text/text";

import { opencodeDataHome } from "../../opencode/opencodeEnvironment";
import { credentialFingerprint, readJsonFile, readSqlite } from "../credentials";
import { fetchJson } from "../http";
import {
  buildSnapshot,
  clampPercent,
  errorSnapshot,
  isoFromString,
  needsAuthSnapshot,
  unsupportedSnapshot,
} from "../parse";
import type { ProviderUsageContext, ProviderUsageFetcher } from "../types";

const SOURCE = "opencode-go-usage";
const USAGE_URL = "https://opencode.ai/zen/go/v1/usage";
// OpenCode 2 imports auth.json into each channel database once; after that the file is stale.
const CREDENTIAL_IMPORT_MIGRATION = "20260805200742_import_legacy_credentials";
// With no calls in the rolling window, the API reports a reset one full window from now.
const PLACEHOLDER_RESET_TOLERANCE_MS = 2_000;

const WINDOWS = [
  { key: "rolling", label: "5h", minutes: 5 * 60, dropsPlaceholderReset: true },
  { key: "weekly", label: "Weekly", minutes: 7 * 24 * 60, dropsPlaceholderReset: false },
  { key: "monthly", label: "Monthly", minutes: 30 * 24 * 60, dropsPlaceholderReset: false },
] as const;

const SIGN_IN_DETAIL =
  "Sign in to OpenCode Go with `opencode auth login` to see its usage limits. Free models have no limits.";

type GoKeyLookup = { readonly found: true; readonly key: string } | { readonly found: false };

// Each release channel keeps its own database (opencode.db, opencode-next.db).
async function channelDatabases(dataHome: string): Promise<string[]> {
  try {
    const names = await fs.readdir(dataHome);
    return names
      .filter((name) => name.startsWith("opencode") && name.endsWith(".db"))
      .toSorted()
      .map((name) => nodePath.join(dataHome, name));
  } catch {
    return [];
  }
}

function readDatabaseGoKey(path: string): GoKeyLookup | null {
  return readSqlite(path, (db) => {
    const imported = db
      .prepare("SELECT 1 FROM migration WHERE id = ? LIMIT 1")
      .get(CREDENTIAL_IMPORT_MIGRATION);
    if (!imported) return null;
    // Ordered like OpenCode itself; legacy imports leave `active` NULL.
    const row = db
      .prepare(
        `SELECT json_extract(value, '$.key') AS key FROM credential
         WHERE integration_id = 'opencode-go' AND (active IS NULL OR active = 1)
         ORDER BY active DESC, time_updated DESC, id DESC LIMIT 1`,
      )
      .get();
    const key = nonEmptyTrimmed(row?.key);
    return key ? { found: true, key } : { found: false };
  });
}

async function readGoKey(ctx: ProviderUsageContext): Promise<string | undefined> {
  const dataHome = opencodeDataHome(ctx.env, ctx.homeDir);
  let databaseOwnsCredentials = false;
  for (const path of await channelDatabases(dataHome)) {
    const lookup = readDatabaseGoKey(path);
    if (lookup?.found) return lookup.key;
    if (lookup) databaseOwnsCredentials = true;
  }
  // A logout in OpenCode 2 deletes the row but leaves the imported auth.json behind.
  if (databaseOwnsCredentials) return undefined;
  const auth = asObjectRecord(await readJsonFile(nodePath.join(dataHome, "auth.json")));
  return nonEmptyTrimmed(asObjectRecord(auth?.["opencode-go"])?.key);
}

function parseLimits(json: unknown, referenceMs: number): ServerProviderUsageLimit[] | null {
  const usage = asObjectRecord(asObjectRecord(json)?.usage);
  if (!usage) return null;
  const limits: ServerProviderUsageLimit[] = [];
  for (const window of WINDOWS) {
    const entry = asObjectRecord(usage[window.key]);
    const usedPercent = clampPercent(asNumericValue(entry?.percent));
    if (usedPercent === undefined) continue;
    const resetsAt = isoFromString(entry?.resetsAt);
    const isPlaceholderReset =
      window.dropsPlaceholderReset &&
      usedPercent === 0 &&
      resetsAt !== undefined &&
      Math.abs(Date.parse(resetsAt) - referenceMs - window.minutes * 60_000) <=
        PLACEHOLDER_RESET_TOLERANCE_MS;
    limits.push({
      window: window.label,
      limitId: window.key,
      usedPercent,
      ...(resetsAt && !isPlaceholderReset ? { resetsAt } : {}),
      windowDurationMins: window.minutes,
    });
  }
  return limits;
}

function errorType(json: unknown): string | undefined {
  return nonEmptyTrimmed(asObjectRecord(asObjectRecord(json)?.error)?.type);
}

export const opencodeUsageFetcher: ProviderUsageFetcher = {
  provider: "opencode",
  async cacheKey(ctx) {
    const key = await readGoKey(ctx);
    return `${ctx.homeDir}:${key ? credentialFingerprint(key) : "none"}`;
  },
  async fetch(ctx) {
    const key = await readGoKey(ctx);
    if (!key) return needsAuthSnapshot("opencode", ctx.nowMs, SOURCE, SIGN_IN_DETAIL);

    let response: Awaited<ReturnType<typeof fetchJson>>;
    try {
      response = await fetchJson({
        service: "provider-usage-opencode",
        url: USAGE_URL,
        allowedOrigins: [new URL(USAGE_URL).origin],
        headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      });
    } catch {
      return errorSnapshot("opencode", ctx.nowMs, SOURCE, "Could not reach OpenCode's usage API.");
    }
    if (response.status === 401) {
      return needsAuthSnapshot(
        "opencode",
        ctx.nowMs,
        SOURCE,
        "OpenCode rejected the stored OpenCode Go key. Sign in again with `opencode auth login`.",
      );
    }
    if (response.status === 403 && errorType(response.json) === "EntitlementError") {
      return unsupportedSnapshot(
        "opencode",
        ctx.nowMs,
        SOURCE,
        "This OpenCode account has no OpenCode Go subscription.",
      );
    }
    if (!response.ok) {
      return errorSnapshot(
        "opencode",
        ctx.nowMs,
        SOURCE,
        `OpenCode usage request failed (HTTP ${response.status}).`,
      );
    }
    const serverDateMs = Date.parse(response.headers.get("date") ?? "");
    const limits = parseLimits(
      response.json,
      Number.isFinite(serverDateMs) ? serverDateMs : ctx.nowMs,
    );
    if (!limits) {
      return errorSnapshot("opencode", ctx.nowMs, SOURCE, "OpenCode's usage response changed.");
    }
    return buildSnapshot({
      provider: "opencode",
      nowMs: ctx.nowMs,
      status: "ok",
      source: SOURCE,
      limits,
      planName: "Go",
    });
  },
};
