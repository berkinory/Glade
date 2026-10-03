import type {
  GladeAppOpenRequest,
  GladeAppOpenAck,
} from "@glade/contracts/provider/agentGatewayTools";
import { ServiceMap } from "effect";
import type { Effect, Stream } from "effect";
import type { ToolInputError } from "../toolInput";

export interface AppPresentationShape {
  readonly open: (
    request: Omit<GladeAppOpenRequest, "requestId">,
  ) => Effect.Effect<void, ToolInputError>;
  readonly acknowledge: (clientId: number, input: GladeAppOpenAck) => Effect.Effect<boolean>;
  readonly stream: (clientId: number) => Stream.Stream<GladeAppOpenRequest>;
}
export class AppPresentation extends ServiceMap.Service<AppPresentation, AppPresentationShape>()(
  "glade/agentGateway/Services/AppPresentation",
) {}
