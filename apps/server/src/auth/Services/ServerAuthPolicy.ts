import type { ServerAuthDescriptor } from "@glade/contracts/transport/auth/auth";
import { Effect, ServiceMap } from "effect";

export interface ServerAuthPolicyShape {
  readonly getDescriptor: () => Effect.Effect<ServerAuthDescriptor>;
}

export class ServerAuthPolicy extends ServiceMap.Service<ServerAuthPolicy, ServerAuthPolicyShape>()(
  "glade/auth/Services/ServerAuthPolicy",
) {}
