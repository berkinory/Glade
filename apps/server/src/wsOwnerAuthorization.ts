import { WsRpcError } from "@glade/contracts/transport/ws/rpc";
import { Effect } from "effect";

import { CurrentWsSessionRole } from "./wsConnectionSessions";

export const requireWsOwnerSession = Effect.gen(function* () {
  if ((yield* CurrentWsSessionRole) !== "owner") {
    return yield* Effect.fail(
      new WsRpcError({ message: "Owner authorization is required for this operation." }),
    );
  }
});
