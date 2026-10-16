import { Effect } from "effect";

import { buildProviderChildEnvironment } from "../core/providerChildEnvironment.ts";
import type { ServerProviderDescriptor } from "../core/serverProviderDescriptor.ts";
import { GROK_ACP_PROFILE } from "./grokAcpProfile.ts";
import { GROK_CLI } from "./grokCli.ts";
import { GROK_CREDENTIAL_GRANTS, grokHome } from "./grokEnvironment.ts";
import { makeGrokStatusCheck } from "./grokStatusCheck.ts";

export const GROK_PROVIDER_DESCRIPTOR: ServerProviderDescriptor = {
  kind: "grok",
  cli: GROK_CLI,
  authentication: {
    loginArgs: ["login"],
    home: { envKey: "GROK_HOME", directory: ".grok" },
    processEnv: async () =>
      buildProviderChildEnvironment({ credentialGrants: GROK_CREDENTIAL_GRANTS }),
  },
  environment: { credentialGrants: GROK_CREDENTIAL_GRANTS },
  modelCatalogIdentity: {
    home: ({ env, homeDir }) => grokHome(env, homeDir),
    account: async () => undefined,
    homeConfigFiles: ["config.toml", "auth.json"],
    workspaceConfigFiles: [],
    environmentKeys: ["XAI_API_KEY", "GROK_HOME"],
  },
  skills: {
    origins: [],
    preferredScopes: [],
    privateOrigins: [{ scope: "grok", directory: ".grok" }],
  },
  makeStatusCheck: (context) => Effect.succeed(makeGrokStatusCheck(context)),
  maintenance: {
    provider: "grok",
    binaryName: GROK_CLI.command,
    npmPackageName: null,
    homebrew: null,
    nativeUpdate: {
      executable: GROK_CLI.command,
      args: () => ["update"],
      lockKey: "grok-native",
      strategy: "always",
      latestVersionSource: { kind: "url", url: "https://x.ai/cli/stable" },
    },
  },
  nativeHistory: { archives: false },
  acp: GROK_ACP_PROFILE,
};
