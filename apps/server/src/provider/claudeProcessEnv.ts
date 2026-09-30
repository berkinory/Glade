import { nonEmptyTrimmed } from "@glade/shared/text/text";
import { asRecord } from "@glade/shared/transport/payloadValues";
import { readFileSync } from "node:fs";
import OS from "node:os";
import nodePath from "node:path";

import { buildProviderChildEnvironment } from "../providerChildEnvironment.ts";

const CLAUDE_DIRECT_CREDENTIAL_ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "CLAUDE_CODE_OAUTH_TOKEN",
] as const;

const CLAUDE_EXTERNAL_AUTH_ENV_KEYS = [
  "ANTHROPIC_BASE_URL",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_ANTHROPIC_AWS",
] as const;

function trimToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function envFlagEnabled(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return Boolean(normalized && normalized !== "0" && normalized !== "false");
}

function hasClaudeExternalAuthEnv(env: NodeJS.ProcessEnv): boolean {
  return CLAUDE_EXTERNAL_AUTH_ENV_KEYS.some((key) => envFlagEnabled(env[key]));
}

function tryParseJsonRecord(content: string): Record<string, unknown> | undefined {
  try {
    return asRecord(JSON.parse(content)) ?? undefined;
  } catch {
    return undefined;
  }
}

export interface ClaudeCliCredentialsSummary {
  readonly usable: boolean;
  readonly subscriptionType?: string;
}

function resolveClaudeCredentialsPaths(input?: {
  readonly env?: NodeJS.ProcessEnv;
  readonly homeDir?: string;
}): ReadonlyArray<string> {
  const env = input?.env ?? process.env;
  const homeDir = trimToUndefined(input?.homeDir) ?? trimToUndefined(env.HOME) ?? OS.homedir();
  const paths: string[] = [];
  const configDir = trimToUndefined(env.CLAUDE_CONFIG_DIR);
  if (configDir) {
    paths.push(nodePath.join(configDir, ".credentials.json"));
  }
  paths.push(nodePath.join(homeDir, ".claude", ".credentials.json"));
  return [...new Set(paths)];
}

function readClaudeCliCredentialsContentSummary(
  content: string,
  nowMs = Date.now(),
): ClaudeCliCredentialsSummary {
  const root = tryParseJsonRecord(content);
  const oauth = asRecord(root?.claudeAiOauth) ?? undefined;
  const accessToken = nonEmptyTrimmed(oauth?.accessToken);
  const refreshToken = nonEmptyTrimmed(oauth?.refreshToken);
  if (!accessToken && !refreshToken) {
    return { usable: false };
  }

  const expiresAtMs = typeof oauth?.expiresAt === "number" ? oauth.expiresAt : undefined;
  const usable = expiresAtMs === undefined || expiresAtMs > nowMs || refreshToken !== undefined;
  const subscriptionType = nonEmptyTrimmed(oauth?.subscriptionType);
  return {
    usable,
    ...(subscriptionType ? { subscriptionType } : {}),
  };
}

function hasUsableClaudeCliCredentials(input?: {
  readonly env?: NodeJS.ProcessEnv;
  readonly homeDir?: string;
  readonly nowMs?: number;
  readonly readFile?: (path: string) => string;
}): boolean {
  return readClaudeCliCredentialsSummary(input).usable;
}

export function readClaudeCliCredentialsSummary(input?: {
  readonly env?: NodeJS.ProcessEnv;
  readonly homeDir?: string;
  readonly nowMs?: number;
  readonly readFile?: (path: string) => string;
}): ClaudeCliCredentialsSummary {
  const readFile = input?.readFile ?? ((path: string) => readFileSync(path, "utf8"));
  for (const path of resolveClaudeCredentialsPaths(input)) {
    try {
      const summary = readClaudeCliCredentialsContentSummary(readFile(path), input?.nowMs);
      if (summary.usable) {
        return summary;
      }
    } catch {
      continue;
    }
  }
  return { usable: false };
}

export function buildClaudeProcessEnv(input?: {
  readonly env?: NodeJS.ProcessEnv;
  readonly homeDir?: string;
  readonly hasClaudeCliCredentials?: boolean;
}): NodeJS.ProcessEnv {
  const env = { ...(input?.env ?? process.env) };
  if (input?.homeDir) {
    env.HOME = input.homeDir;
  }
  const credentialInput = input?.homeDir ? { env, homeDir: input.homeDir } : { env };
  const hasLocalClaudeAuth =
    input?.hasClaudeCliCredentials ?? hasUsableClaudeCliCredentials(credentialInput);

  if (!hasLocalClaudeAuth || hasClaudeExternalAuthEnv(env)) {
    return buildProviderChildEnvironment({ provider: "claude", baseEnv: env });
  }

  for (const key of CLAUDE_DIRECT_CREDENTIAL_ENV_KEYS) {
    delete env[key];
  }
  return buildProviderChildEnvironment({ provider: "claude", baseEnv: env });
}

export function withClaudeArtifactOptIn(
  env: NodeJS.ProcessEnv,
  enableArtifacts: boolean | undefined,
): NodeJS.ProcessEnv {
  if (enableArtifacts === true) return { ...env, CLAUDE_CODE_ARTIFACT: "1" };
  // The setting is authoritative: a value inherited from the shell that launched Glade must not
  // publish while Settings and discovery report Artifacts as off.
  if (env.CLAUDE_CODE_ARTIFACT === undefined) return env;
  const { CLAUDE_CODE_ARTIFACT: _inherited, ...rest } = env;
  return rest;
}
