import type { ExecutionEnvironmentDescriptor } from "@glade/contracts/workspace/environment";
import { Effect, ServiceMap } from "effect";

export interface ServerEnvironmentShape {
  readonly getDescriptor: Effect.Effect<ExecutionEnvironmentDescriptor>;
}

export class ServerEnvironment extends ServiceMap.Service<
  ServerEnvironment,
  ServerEnvironmentShape
>()("glade/environment/Services/ServerEnvironment") {}
