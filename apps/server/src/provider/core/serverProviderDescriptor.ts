import type { ProviderKind } from "@glade/contracts/core/baseSchemas";
import type { ServerProviderStatus } from "@glade/contracts/server/server";
import type { ServerSettings } from "@glade/contracts/settings/settings";
import type { Effect, FileSystem, Path } from "effect";
import type { ChildProcessSpawner } from "effect/unstable/process";
import type { AcpProviderProfile } from "../acp/acpProviderProfile.ts";
import type { ProviderCredentialGrants } from "./providerChildEnvironment.ts";
import type { PackageManagedProviderMaintenanceDefinition } from "./providerMaintenance.ts";

export interface ProviderCli {
  // The executable used when the provider settings leave the binary path empty.
  readonly command: string;
  readonly displayName: string;
  readonly minimumVersion: string;
}

export type ProviderStatusCheck = (
  settings: ServerSettings,
) => Effect.Effect<
  ServerProviderStatus,
  never,
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | Path.Path
>;

interface ProviderPluginSkillRoot {
  readonly path: string;
  readonly scope: string;
  readonly namespace: string;
  readonly followSymlinks: false;
}

// Server-only knowledge about one provider. Generic provider code reads these fields instead of
// branching on a provider kind.
export interface ServerProviderDescriptor {
  readonly kind: ProviderKind;
  readonly cli: ProviderCli;
  readonly authentication: {
    readonly loginArgs: ReadonlyArray<string>;
    // Sign-in writes to `<homeDir>/<directory>` unless `envKey` names another home.
    readonly home: { readonly envKey: string; readonly directory: string };
    readonly processEnv: (input: {
      readonly settings: ServerSettings;
      readonly homeDir: string;
    }) => Promise<NodeJS.ProcessEnv>;
  };
  readonly environment: { readonly credentialGrants: ProviderCredentialGrants };
  // Inputs that change the native model catalog; their digest keys the catalog cache.
  readonly modelCatalogIdentity: {
    readonly home: (input: {
      readonly env: NodeJS.ProcessEnv;
      readonly settings: ServerSettings;
      readonly homeDir: string;
    }) => string;
    readonly account: (input: {
      readonly home: string;
      readonly homeDir: string;
    }) => Promise<unknown>;
    readonly homeConfigFiles: ReadonlyArray<string>;
    readonly workspaceConfigFiles: ReadonlyArray<string>;
    readonly environmentKeys: ReadonlyArray<string>;
  };
  readonly skills: {
    // Skills live in `<home>/<directory>/skills` and in `<directory>/skills` of project ancestors.
    readonly origins: ReadonlyArray<{ readonly scope: string; readonly directory: string }>;
    readonly preferredScopes: ReadonlyArray<string>;
    readonly pluginRoots?: (input: {
      readonly homeDir: string;
      readonly cwd?: string;
    }) => Promise<ReadonlyArray<ProviderPluginSkillRoot>>;
  };
  // Built once per ProviderHealth layer so a check can own caches that outlive one refresh.
  readonly makeStatusCheck: (context: {
    readonly homeDir: string;
  }) => Effect.Effect<ProviderStatusCheck>;
  readonly maintenance: PackageManagedProviderMaintenanceDefinition;
  readonly nativeHistory: { readonly archives: boolean };
  readonly mcp: { readonly writesRequireConfigVersion: boolean };
  // Providers that speak the Agent Client Protocol run on the shared ACP adapter.
  readonly acp?: AcpProviderProfile;
}
