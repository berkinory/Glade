import { spawnProcess } from "@glade/shared/platform/processRuntime";
import { Effect, Layer, Option } from "effect";

import { AgentGatewayCredentials } from "../../agentGateway/Services/AgentGatewayCredentials.ts";
import { ServerConfig } from "../../server/config.ts";
import { makeMuseAdapter } from "../muse/museAdapter.ts";
import { MUSE_CLI } from "../muse/museCli.ts";
import { museChildEnvironment } from "../muse/museEnvironment.ts";
import { MuseAdapter } from "../Services/MuseAdapter.ts";

export const MuseAdapterLive = Layer.effect(
  MuseAdapter,
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const gatewayCredentials = Option.getOrUndefined(
      yield* Effect.serviceOption(AgentGatewayCredentials),
    );
    return yield* makeMuseAdapter({
      defaultCwd: config.cwd,
      gatewayCredentials,
      spawn: ({ cwd, binaryPath, args }) =>
        spawnProcess(binaryPath ?? MUSE_CLI.command, args, {
          requireExecutable: true,
          cwd,
          env: museChildEnvironment(),
          stdio: ["pipe", "pipe", "pipe"],
        }),
    });
  }),
);
