import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Effect } from "effect";
import type { ProviderListModelsInput } from "@glade/contracts/provider/providerDiscovery";
import type { ServerSettings } from "@glade/contracts/settings/settings";
import { resolveExecutable } from "@glade/shared/platform/executable";
import { serverProviderDescriptor } from "../builtInProviders.ts";
import { ProviderAdapterRequestError } from "./Errors.ts";

export const modelDiscoveryContext = (input: {
  readonly request: ProviderListModelsInput;
  readonly settings: ServerSettings;
  readonly homeDir: string;
}) =>
  Effect.tryPromise({
    try: async () => {
      const provider = input.request.provider;
      const settings = input.settings.providers[provider];
      const env = process.env;
      const descriptor = serverProviderDescriptor(provider);
      const catalog = descriptor.modelCatalogIdentity;
      const binary =
        input.request.binaryPath?.trim() || settings.binaryPath?.trim() || descriptor.cli.command;
      const executable = resolveExecutable(binary, {
        env,
        ...(input.request.cwd ? { cwd: input.request.cwd } : {}),
      });
      const home = catalog.home({ env, settings: input.settings, homeDir: input.homeDir });
      const account = await catalog.account({ home, homeDir: input.homeDir });
      const files = catalog.homeConfigFiles.map((file) => path.join(home, file));
      if (executable) files.push(executable);
      const globalFileCount = files.length;
      const cwd = input.request.cwd;
      if (cwd) files.push(...catalog.workspaceConfigFiles.map((file) => path.join(cwd, file)));
      const revisions = await Promise.all(
        files.map(async (file) => {
          try {
            const info = await stat(file, { bigint: true });
            return [file, String(info.mtimeNs), String(info.size), String(info.ino)];
          } catch (error) {
            if (error instanceof Error && "code" in error && error.code === "ENOENT")
              return [file, "missing"];
            throw error;
          }
        }),
      );
      // Native CLIs rewrite token and usage caches during discovery. Only account identity and real
      // settings affect the catalog; credentials remain confined to this digest, never persisted keys.
      const identity = createHash("sha256")
        .update(
          JSON.stringify({
            settings,
            executable,
            home,
            account,
            revisions: revisions.slice(0, globalFileCount),
            environment: catalog.environmentKeys.map((key) => env[key]),
          }),
        )
        .digest("hex");
      const workspaceRevisions = revisions.slice(globalFileCount);
      const workspaceIdentity = workspaceRevisions.some((revision) => revision[1] !== "missing")
        ? createHash("sha256").update(JSON.stringify(workspaceRevisions)).digest("hex")
        : null;
      return { identity, workspaceIdentity, binaryPath: executable ?? binary };
    },
    catch: (cause) =>
      new ProviderAdapterRequestError({
        provider: input.request.provider,
        method: "models/list",
        detail: "Could not inspect the provider runtime configuration for model discovery.",
        cause,
      }),
  });
