import { join } from "node:path";
import { ServerConfig } from "../../server/config.ts";
import { Effect, Layer, Option } from "effect";
import type { ComputerAvailability } from "@glade/contracts/computer/computer";

import { CUA_HOST_SOCKET_ENV } from "@glade/shared/computer/cuaDriverProtocol";
import { ComputerManager } from "../ComputerManager.ts";
import { CuaComputerBackend } from "../CuaComputerBackend.ts";
import { FakeComputerBackend } from "../FakeComputerBackend.ts";
import { UnavailableComputerBackend } from "../UnavailableComputerBackend.ts";
import { ComputerService, type ComputerServiceShape } from "../Services/ComputerService.ts";
import type { ComputerBackend } from "../ComputerBackend.ts";
import { resolveBrowserHostCapability } from "../../browserAutomation/browserHostRpcClient.ts";

export interface ComputerServiceLiveOptions {
  readonly backend?: ComputerBackend;

  readonly supported?: boolean;

  readonly platform?: NodeJS.Platform;
}

let warnedMissingControlStatePath = false;

function makeComputerServiceLayer(options: ComputerServiceLiveOptions = {}) {
  return Layer.effect(
    ComputerService,
    Effect.gen(function* () {
      const platform = options.platform ?? process.platform;
      const requestedBackend = process.env.GLADE_COMPUTER_BACKEND?.trim().toLowerCase();
      const unavailableAvailability: ComputerAvailability =
        platform === "linux"
          ? {
              kind: "backend-unavailable",
              message: "No computer backend is available on this server.",
            }
          : { kind: "unsupported-platform", platform };
      // No endpoint means no backend — the gate is reachability, never platform optimism.
      const hostEndpoint = process.env[CUA_HOST_SOCKET_ENV]?.trim();
      const backend =
        options.backend ??
        (requestedBackend === "fake" ? new FakeComputerBackend() : undefined) ??
        (platform === "darwin" || hostEndpoint
          ? new CuaComputerBackend({
              capability: resolveBrowserHostCapability() ?? undefined,
            })
          : undefined) ??
        new UnavailableComputerBackend(
          `No computer backend is configured for this server running on ${platform}.`,
          { availability: unavailableAvailability },
        );
      const config = yield* Effect.serviceOption(ServerConfig);
      if (Option.isNone(config) && !warnedMissingControlStatePath) {
        warnedMissingControlStatePath = true;
        yield* Effect.logWarning(
          "computer control state path unavailable; using in-memory control state",
        );
      }
      const manager = new ComputerManager({
        backend,
        ...(Option.isSome(config)
          ? {
              controlStatePath: join(config.value.stateDir, "computer-control.json"),

              auditLogPath: join(config.value.stateDir, "computer-audit.jsonl"),
            }
          : {}),
      });
      yield* Effect.addFinalizer(() => Effect.promise(() => manager.dispose()));
      let availability: ComputerAvailability;
      if (options.supported === undefined) {
        availability = yield* Effect.promise(() => backend.probeAvailability());
      } else if (options.supported) {
        availability = { kind: "available", backend: "test-override" };
      } else {
        availability = {
          kind: "backend-unavailable",
          message: "Computer support is disabled by the service configuration.",
        };
      }
      return {
        supported: options.supported ?? !(backend instanceof UnavailableComputerBackend),
        availability,
        manager,
      } satisfies ComputerServiceShape;
    }),
  );
}

export const ComputerServiceLive = makeComputerServiceLayer();
