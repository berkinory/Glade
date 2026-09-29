import { WsRpcError } from "@glade/contracts";
import { Effect } from "effect";

import { CurrentWsSessionRole } from "./wsConnectionSessions";

export const requireWsOwnerSession = Effect.gen(function* () {
  if ((yield* CurrentWsSessionRole) !== "owner") {
    return yield* Effect.fail(
      new WsRpcError({ message: "Owner authorization is required for this operation." }),
    );
  }
});
