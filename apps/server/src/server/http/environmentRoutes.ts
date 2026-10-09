import {
  ENVIRONMENT_DESCRIPTOR_PATH,
  type PublicEnvironmentDescriptor,
} from "@glade/contracts/workspace/environment";
import {
  WS_PROTOCOL_EPOCH,
  WS_PROTOCOL_MAX_REVISION,
  WS_PROTOCOL_MIN_REVISION,
} from "@glade/contracts/transport/ws/wsCompatibility";
import { Effect } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import { ServerAuth } from "../../auth/Services/ServerAuth";
import { ServerEnvironment } from "../../environment/Services/ServerEnvironment";
import { authDescriptorFor } from "../../remoteAccess/remoteRequests";

export const environmentDescriptorRouteLayer = HttpRouter.add(
  "GET",
  ENVIRONMENT_DESCRIPTOR_PATH,
  Effect.gen(function* () {
    const environment = yield* (yield* ServerEnvironment).getDescriptor;
    const auth = authDescriptorFor(
      yield* HttpServerRequest.HttpServerRequest,
      yield* (yield* ServerAuth).getDescriptor(),
    );
    return HttpServerResponse.jsonUnsafe(
      {
        environmentId: environment.environmentId,
        label: environment.label,
        platform: environment.platform,
        serverVersion: environment.serverVersion,
        protocol: {
          epoch: WS_PROTOCOL_EPOCH,
          minRevision: WS_PROTOCOL_MIN_REVISION,
          maxRevision: WS_PROTOCOL_MAX_REVISION,
        },
        auth,
      } satisfies PublicEnvironmentDescriptor,
      { headers: { "Cache-Control": "no-store" } },
    );
  }),
);
