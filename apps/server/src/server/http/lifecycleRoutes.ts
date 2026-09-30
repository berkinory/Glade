import {
  type ServerShutdownController,
  DESKTOP_SHUTDOWN_ROUTE_PATH,
  authorizeDesktopShutdown,
  DESKTOP_COMPUTER_EMERGENCY_STOP_ROUTE_PATH,
} from "../lifecycle/serverShutdown";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { Effect, Option, Cause } from "effect";
import { ServerConfig } from "../config";
import { ComputerService } from "../../computer/Services/ComputerService";
import type { ServerReadiness } from "../readiness";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine";

export function makeDesktopShutdownEffectRouteLayer(shutdownController: ServerShutdownController) {
  return HttpRouter.add(
    "POST",
    DESKTOP_SHUTDOWN_ROUTE_PATH,
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const config = yield* ServerConfig;
      const authorization = authorizeDesktopShutdown({
        config,
        remoteAddress: request.remoteAddress,
        authorization: request.headers.authorization,
      });

      if (!authorization.authorized) {
        return HttpServerResponse.jsonUnsafe(
          { error: authorization.reason === "unavailable" ? "Not Found" : "Unauthorized" },
          {
            status: authorization.status,
            ...(authorization.status === 401
              ? { headers: { "WWW-Authenticate": 'Bearer realm="glade-desktop-shutdown"' } }
              : {}),
          },
        );
      }

      yield* shutdownController.requestStop;
      return HttpServerResponse.jsonUnsafe({ accepted: true }, { status: 202 });
    }),
  );
}

export function makeDesktopComputerEmergencyStopRouteLayer() {
  return HttpRouter.add(
    "POST",
    DESKTOP_COMPUTER_EMERGENCY_STOP_ROUTE_PATH,
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const config = yield* ServerConfig;
      const authorization = authorizeDesktopShutdown({
        config,
        remoteAddress: request.remoteAddress,
        authorization: request.headers.authorization,
      });

      if (!authorization.authorized) {
        return HttpServerResponse.jsonUnsafe(
          { error: authorization.reason === "unavailable" ? "Not Found" : "Unauthorized" },
          {
            status: authorization.status,
            ...(authorization.status === 401
              ? { headers: { "WWW-Authenticate": 'Bearer realm="glade-desktop-emergency-stop"' } }
              : {}),
          },
        );
      }

      const computerService = Option.getOrUndefined(yield* Effect.serviceOption(ComputerService));
      if (!computerService) {
        return HttpServerResponse.jsonUnsafe({ accepted: false }, { status: 404 });
      }

      yield* Effect.promise(() => computerService.manager.emergencyStopInput()).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("desktop computer emergency stop failed", Cause.pretty(cause)),
        ),
      );
      return HttpServerResponse.jsonUnsafe({ accepted: true }, { status: 202 });
    }),
  );
}

export function makeHealthEffectRouteLayer(readiness: ServerReadiness) {
  return HttpRouter.add(
    "GET",
    "/health",
    Effect.gen(function* () {
      const snapshot = yield* readiness.getSnapshot;
      const orchestrationEngine = yield* OrchestrationEngineService;
      const projection = yield* orchestrationEngine.getProjectionCatchUpStatus;
      return HttpServerResponse.jsonUnsafe(
        {
          status: "ok",
          startupReady: snapshot.startupReady,
          pushBusReady: snapshot.pushBusReady,
          keybindingsReady: snapshot.keybindingsReady,
          terminalSubscriptionsReady: snapshot.terminalSubscriptionsReady,
          orchestrationSubscriptionsReady: snapshot.orchestrationSubscriptionsReady,

          projection: {
            state: projection.state,
            inFlight: projection.inFlight,
            retryAttempts: projection.retryAttempts,
            hasFailure: projection.lastFailure !== null,
            highWaterSequence: projection.highWaterSequence,
            lagByProjector: projection.lagByProjector,
            missingProjectors: projection.missingProjectors,
          },
        },
        { status: 200 },
      );
    }),
  );
}
