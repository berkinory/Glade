import path from "node:path";
import { Effect } from "effect";
import { readNativeIdentityFile } from "../core/nativeIdentityFile.ts";
import { normalizeCommandPath } from "../core/providerMaintenance.ts";
import type { ServerProviderDescriptor } from "../core/serverProviderDescriptor.ts";
import { CODEX_CLI } from "./codexCliVersion.ts";
import { resolveBaseCodexHomePath } from "./codexHomePaths.ts";
import { buildCodexProcessEnv, CODEX_CREDENTIAL_GRANTS } from "./codexProcessEnv.ts";
import { checkCodexProviderStatus } from "./codexStatusCheck.ts";

export const CODEX_PROVIDER_DESCRIPTOR: ServerProviderDescriptor = {
  kind: "codex",
  cli: CODEX_CLI,
  authentication: {
    loginArgs: ["login"],
    home: { envKey: "CODEX_HOME", directory: ".codex" },
    processEnv: ({ settings }) =>
      buildCodexProcessEnv({ homePath: settings.providers.codex.homePath }),
  },
  environment: { credentialGrants: CODEX_CREDENTIAL_GRANTS },
  modelCatalogIdentity: {
    home: ({ env, settings }) => resolveBaseCodexHomePath(env, settings.providers.codex.homePath),
    account: async ({ home }) => {
      const auth = await readNativeIdentityFile(path.join(home, "auth.json"));
      const tokens = auth?.tokens;
      return {
        mode: auth?.auth_mode,
        apiKey: auth?.OPENAI_API_KEY,
        account:
          typeof tokens === "object" && tokens !== null && "account_id" in tokens
            ? tokens.account_id
            : tokens,
      };
    },
    homeConfigFiles: ["config.toml"],
    workspaceConfigFiles: [path.join(".codex", "config.toml")],
    environmentKeys: ["OPENAI_API_KEY", "OPENAI_BASE_URL", "CODEX_HOME"],
  },
  skills: {
    origins: [{ scope: "codex", directory: ".codex" }],
    preferredScopes: ["codex", "agents"],
  },
  makeStatusCheck: () => Effect.succeed(checkCodexProviderStatus),
  maintenance: {
    provider: "codex",
    binaryName: CODEX_CLI.command,
    npmPackageName: "@openai/codex",
    homebrew: { name: "codex", kind: "cask" },
    nativeUpdate: {
      executable: CODEX_CLI.command,
      args: () => ["update"],
      lockKey: "codex-native",
      strategy: "matching-path",
      latestVersionSource: { kind: "npm", name: "@openai/codex" },
      isCommandPath: (commandPath) =>
        normalizeCommandPath(commandPath).includes("/.codex/packages/standalone/"),
    },
  },
  nativeHistory: { archives: true },
};
