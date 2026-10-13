import { homedir } from "node:os";
import path from "node:path";
import { Effect } from "effect";

import type { ServerProviderDescriptor } from "../core/serverProviderDescriptor.ts";
import { MUSE_CLI } from "./museCli.ts";
import { MUSE_CREDENTIAL_GRANTS, museChildEnvironment } from "./museEnvironment.ts";
import { checkMuseProviderStatus } from "./museStatusCheck.ts";

const museHome = (env: NodeJS.ProcessEnv, homeDir: string) =>
  path.join(
    env.XDG_DATA_HOME?.trim() || path.join(homeDir || env.HOME || homedir(), ".local", "share"),
    "muse",
  );

export const MUSE_PROVIDER_DESCRIPTOR: ServerProviderDescriptor = {
  kind: "museCode",
  cli: MUSE_CLI,
  authentication: {
    loginArgs: ["login"],
    home: { envKey: "XDG_DATA_HOME", directory: path.join(".local", "share", "muse") },
    processEnv: async () => museChildEnvironment(),
  },
  environment: { credentialGrants: MUSE_CREDENTIAL_GRANTS },
  modelCatalogIdentity: {
    home: ({ env, homeDir }) => museHome(env, homeDir),
    account: async () => undefined,
    homeConfigFiles: [],
    workspaceConfigFiles: [],
    environmentKeys: ["META_API_KEY", "MUSE_MODEL", "XDG_DATA_HOME", "XDG_CONFIG_HOME"],
  },
  skills: { origins: [], preferredScopes: [] },
  makeStatusCheck: () => Effect.succeed(checkMuseProviderStatus),
  // The `muse` launcher updates itself; it has no update command to run.
  maintenance: {
    provider: "museCode",
    binaryName: MUSE_CLI.command,
    npmPackageName: null,
    homebrew: null,
    nativeUpdate: null,
  },
  nativeHistory: { archives: false },
  mcp: { writesRequireConfigVersion: false },
};
