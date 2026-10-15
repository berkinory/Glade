import { homedir } from "node:os";
import path from "node:path";
import { decodeNativeIdentityRecord, readNativeIdentityFile } from "../core/nativeIdentityFile.ts";
import { normalizeCommandPath } from "../core/providerMaintenance.ts";
import type { ServerProviderDescriptor } from "../core/serverProviderDescriptor.ts";
import { CLAUDE_CLI } from "./claudeCli.ts";
import { discoverClaudePluginSkillRoots } from "./claudePluginSkills.ts";
import { buildClaudeProcessEnv, CLAUDE_CREDENTIAL_GRANTS } from "./claudeProcessEnv.ts";
import { makeClaudeStatusCheck } from "./claudeStatusCheck.ts";

const ACCOUNT_IDENTITY_KEYS = [
  "accountUuid",
  "organizationUuid",
  "seatTier",
  "organizationRateLimitTier",
  "userRateLimitTier",
  "billingType",
] as const;

function isNativeCommandPath(commandPath: string): boolean {
  const normalized = normalizeCommandPath(commandPath);
  return (
    normalized.endsWith("/.local/bin/claude") ||
    normalized.endsWith("/.local/bin/claude.exe") ||
    normalized.includes("/.local/share/claude/")
  );
}

export const CLAUDE_PROVIDER_DESCRIPTOR: ServerProviderDescriptor = {
  kind: "claudeAgent",
  cli: CLAUDE_CLI,
  authentication: {
    loginArgs: ["auth", "login"],
    home: { envKey: "CLAUDE_CONFIG_DIR", directory: ".claude" },
    processEnv: async ({ homeDir }) => buildClaudeProcessEnv({ homeDir }),
  },
  environment: { credentialGrants: CLAUDE_CREDENTIAL_GRANTS },
  modelCatalogIdentity: {
    home: ({ env, homeDir }) =>
      env.CLAUDE_CONFIG_DIR?.trim() || path.join(homeDir || env.HOME || homedir(), ".claude"),
    account: async ({ home, homeDir }) => {
      const config = await readNativeIdentityFile(path.join(homeDir, ".claude.json"));
      const account = config?.oauthAccount;
      if (typeof account === "object" && account !== null && "accountUuid" in account) {
        const metadata = decodeNativeIdentityRecord(account);
        return Object.fromEntries(ACCOUNT_IDENTITY_KEYS.map((key) => [key, metadata[key]]));
      }
      return readNativeIdentityFile(path.join(home, ".credentials.json"));
    },
    homeConfigFiles: ["settings.json"],
    workspaceConfigFiles: [
      path.join(".claude", "settings.json"),
      path.join(".claude", "settings.local.json"),
    ],
    environmentKeys: [
      "ANTHROPIC_API_KEY",
      "ANTHROPIC_AUTH_TOKEN",
      "CLAUDE_CODE_OAUTH_TOKEN",
      "ANTHROPIC_BASE_URL",
      "CLAUDE_CODE_USE_BEDROCK",
      "CLAUDE_CODE_USE_VERTEX",
    ],
  },
  skills: {
    origins: [{ scope: "claude", directory: ".claude" }],
    preferredScopes: ["claude"],
    pluginRoots: discoverClaudePluginSkillRoots,
  },
  makeStatusCheck: makeClaudeStatusCheck,
  maintenance: {
    provider: "claudeAgent",
    binaryName: CLAUDE_CLI.command,
    npmPackageName: "@anthropic-ai/claude-code",
    homebrew: {
      name: "claude-code",
      kind: "cask",
      variants: [
        {
          name: "claude-code@latest",
          kind: "cask",
          isCommandPath: (commandPath) =>
            normalizeCommandPath(commandPath).includes("/caskroom/claude-code@latest/"),
        },
      ],
    },
    nativeUpdate: {
      executable: CLAUDE_CLI.command,
      args: () => ["update"],
      lockKey: "claude-native",
      strategy: "matching-path",
      // `claude update` follows the latest channel unless the user pinned stable in Claude Code.
      latestVersionSource: {
        kind: "url",
        url: "https://downloads.claude.ai/claude-code-releases/latest",
      },
      isCommandPath: isNativeCommandPath,
    },
  },
  nativeHistory: { archives: false },
};
