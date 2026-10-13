import { Effect } from "effect";

import { buildProviderChildEnvironment } from "../core/providerChildEnvironment.ts";
import type { ServerProviderDescriptor } from "../core/serverProviderDescriptor.ts";
import { DROID_ACP_PROFILE } from "./droidAcpProfile.ts";
import { DROID_CLI } from "./droidCli.ts";
import { DROID_CREDENTIAL_GRANTS, DROID_PROCESS_OVERRIDES, droidHome } from "./droidEnvironment.ts";
import { checkDroidProviderStatus } from "./droidStatusCheck.ts";

export const DROID_PROVIDER_DESCRIPTOR: ServerProviderDescriptor = {
  kind: "factoryDroid",
  cli: DROID_CLI,
  authentication: {
    // Droid has no login command; its interactive session starts the device pairing sign-in.
    loginArgs: [],
    home: { envKey: "FACTORY_HOME_OVERRIDE", directory: ".factory" },
    processEnv: async () =>
      buildProviderChildEnvironment({
        credentialGrants: DROID_CREDENTIAL_GRANTS,
        overrides: DROID_PROCESS_OVERRIDES,
      }),
  },
  environment: { credentialGrants: DROID_CREDENTIAL_GRANTS },
  modelCatalogIdentity: {
    home: ({ env, homeDir }) => droidHome(env, homeDir),
    account: async () => undefined,
    homeConfigFiles: ["settings.json", "settings.local.json"],
    workspaceConfigFiles: [],
    environmentKeys: ["FACTORY_API_KEY", "FACTORY_HOME_OVERRIDE"],
  },
  skills: { origins: [], preferredScopes: [] },
  makeStatusCheck: () => Effect.succeed(checkDroidProviderStatus),
  maintenance: {
    provider: "factoryDroid",
    binaryName: DROID_CLI.command,
    npmPackageName: null,
    homebrew: null,
    nativeUpdate: {
      executable: DROID_CLI.command,
      args: () => ["update"],
      lockKey: "droid-native",
      strategy: "always",
      latestVersionSource: null,
    },
  },
  nativeHistory: { archives: false },
  mcp: { writesRequireConfigVersion: false },
  acp: DROID_ACP_PROFILE,
};
