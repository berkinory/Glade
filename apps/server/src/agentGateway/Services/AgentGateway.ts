import { ServiceMap } from "effect";
import type { Effect } from "effect";

interface AgentGatewayHttpResult {
  readonly status: number;

  readonly body?: unknown;
}

export interface AgentGatewayShape {
  readonly handleMcpPost: (input: {
    readonly authorizationHeader: string | undefined;
    readonly body: unknown;
  }) => Effect.Effect<AgentGatewayHttpResult>;
}

export class AgentGateway extends ServiceMap.Service<AgentGateway, AgentGatewayShape>()(
  "glade/agentGateway/Services/AgentGateway",
) {}
