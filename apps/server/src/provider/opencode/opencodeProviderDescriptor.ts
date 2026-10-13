import path from "node:path";
import { Effect } from "effect";

import { buildProviderChildEnvironment } from "../core/providerChildEnvironment.ts";
import type { ServerProviderDescriptor } from "../core/serverProviderDescriptor.ts";
import { OPENCODE_ACP_PROFILE } from "./opencodeAcpProfile.ts";
import { OPENCODE_CLI } from "./opencodeCli.ts";
import { opencodeDataHome } from "./opencodeEnvironment.ts";
import { checkOpenCodeProviderStatus } from "./opencodeStatusCheck.ts";

export const OPENCODE_PROVIDER_DESCRIPTOR: ServerProviderDescriptor = {
  kind: "opencode",
  cli: OPENCODE_CLI,
  authentication: {
    loginArgs: ["auth", "login"],
    home: { envKey: "XDG_DATA_HOME", directory: path.join(".local", "share", "opencode") },
    processEnv: async () => buildProviderChildEnvironment({ credentialGrants: "all" }),
  },
  // OpenCode routes to whichever model provider the user configured, so it reads their API keys.
  environment: { credentialGrants: "all" },
  modelCatalogIdentity: {
    home: ({ env, homeDir }) => opencodeDataHome(env, homeDir),
    account: async () => undefined,
    homeConfigFiles: [],
    workspaceConfigFiles: ["opencode.json", "opencode.jsonc"],
    environmentKeys: ["OPENCODE_CONFIG", "OPENCODE_CONFIG_CONTENT", "XDG_DATA_HOME"],
  },
  skills: { origins: [], preferredScopes: [] },
  makeStatusCheck: () => Effect.succeed(checkOpenCodeProviderStatus),
  maintenance: {
    provider: "opencode",
    binaryName: OPENCODE_CLI.command,
    npmPackageName: null,
    homebrew: { name: "opencode", kind: "formula" },
    nativeUpdate: {
      executable: OPENCODE_CLI.command,
      args: () => ["upgrade"],
      lockKey: "opencode-native",
      strategy: "always",
      latestVersionSource: null,
    },
  },
  nativeHistory: { archives: false },
  mcp: { writesRequireConfigVersion: false },
  acp: OPENCODE_ACP_PROFILE,
};
