import { spawnProcess } from "@glade/shared/platform/processRuntime";
import { Effect, Layer, Option } from "effect";

import { AgentGatewayCredentials } from "../../agentGateway/Services/AgentGatewayCredentials.ts";
import { ServerConfig } from "../../server/config.ts";
import { makeAcpAdapter } from "../acp/acpAdapter.ts";
import { BUILT_IN_PROVIDERS } from "../builtInProviders.ts";
import { buildProviderChildEnvironment } from "../core/providerChildEnvironment.ts";
import { AcpAdapters } from "../Services/AcpAdapters.ts";

export const AcpAdaptersLive = Layer.effect(
  AcpAdapters,
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const gatewayCredentials = Option.getOrUndefined(
      yield* Effect.serviceOption(AgentGatewayCredentials),
    );
    return yield* Effect.forEach(
      BUILT_IN_PROVIDERS.flatMap((descriptor) =>
        descriptor.acp ? [{ descriptor, profile: descriptor.acp }] : [],
      ),
      ({ descriptor, profile }) =>
        makeAcpAdapter({
          profile,
          defaultCwd: config.cwd,
          gatewayCredentials,
          spawn: ({ cwd, runtimeMode, binaryPath }) =>
            spawnProcess(binaryPath ?? descriptor.cli.command, profile.args, {
              requireExecutable: true,
              cwd,
              env: buildProviderChildEnvironment({
                credentialGrants: descriptor.environment.credentialGrants,
                ...(profile.env ? { overrides: profile.env({ runtimeMode }) } : {}),
              }),
              stdio: ["pipe", "pipe", "pipe"],
            }),
        }),
    );
  }),
);
