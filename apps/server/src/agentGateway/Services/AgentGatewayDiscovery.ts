import type { GladeListThreadsInput } from "@glade/contracts/provider/agentGatewayDiscovery";
import type {
  OrchestrationProjectShell,
  OrchestrationThreadShell,
} from "@glade/contracts/orchestration/threadEntities";
import { ServiceMap } from "effect";
import type { Effect } from "effect";
import type { ProjectionRepositoryError } from "../../persistence/Errors";
import type { ToolInputError } from "../toolInput";

export interface AgentGatewayDiscoveryShape {
  readonly listProjects: Effect.Effect<
    ReadonlyArray<OrchestrationProjectShell>,
    ProjectionRepositoryError
  >;
  readonly listThreads: (input: GladeListThreadsInput) => Effect.Effect<
    {
      readonly threads: ReadonlyArray<OrchestrationThreadShell>;
      readonly nextCursor: string | null;
    },
    ProjectionRepositoryError | ToolInputError
  >;
}

export class AgentGatewayDiscovery extends ServiceMap.Service<
  AgentGatewayDiscovery,
  AgentGatewayDiscoveryShape
>()("glade/agentGateway/Services/AgentGatewayDiscovery") {}
