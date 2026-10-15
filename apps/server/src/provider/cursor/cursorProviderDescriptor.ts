import { homedir } from "node:os";
import path from "node:path";
import { Effect } from "effect";

import { buildProviderChildEnvironment } from "../core/providerChildEnvironment.ts";
import type { ServerProviderDescriptor } from "../core/serverProviderDescriptor.ts";
import { CURSOR_ACP_PROFILE } from "./cursorAcpProfile.ts";
import { CURSOR_CLI } from "./cursorCli.ts";
import { CURSOR_CREDENTIAL_GRANTS } from "./cursorEnvironment.ts";
import { checkCursorProviderStatus } from "./cursorStatusCheck.ts";

export const CURSOR_PROVIDER_DESCRIPTOR: ServerProviderDescriptor = {
  kind: "cursor",
  cli: CURSOR_CLI,
  authentication: {
    loginArgs: ["login"],
    home: { envKey: "CURSOR_CONFIG_DIR", directory: ".cursor" },
    processEnv: async () =>
      buildProviderChildEnvironment({ credentialGrants: CURSOR_CREDENTIAL_GRANTS }),
  },
  environment: { credentialGrants: CURSOR_CREDENTIAL_GRANTS },
  modelCatalogIdentity: {
    home: ({ env, homeDir }) =>
      env.CURSOR_CONFIG_DIR?.trim() || path.join(homeDir || env.HOME || homedir(), ".cursor"),
    account: async () => undefined,
    homeConfigFiles: ["cli-config.json"],
    workspaceConfigFiles: [],
    environmentKeys: ["CURSOR_API_KEY", "CURSOR_API_ENDPOINT"],
  },
  skills: { origins: [], preferredScopes: [] },
  makeStatusCheck: () => Effect.succeed(checkCursorProviderStatus),
  maintenance: {
    provider: "cursor",
    binaryName: CURSOR_CLI.command,
    npmPackageName: null,
    homebrew: null,
    nativeUpdate: {
      executable: CURSOR_CLI.command,
      args: () => ["update"],
      lockKey: "cursor-native",
      strategy: "always",
      // Cursor publishes no version endpoint; its installer names the current build in the URL.
      latestVersionSource: {
        kind: "url",
        url: "https://cursor.com/install",
        pattern: /downloads\.cursor\.com\/lab\/([^/\s]+)\//,
      },
    },
  },
  nativeHistory: { archives: false },
  acp: CURSOR_ACP_PROFILE,
};
