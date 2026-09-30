import { ServiceMap } from "effect";
import type { ProviderServiceShape } from "./ProviderService";
export class ProviderTurnDispatch extends ServiceMap.Service<
  ProviderTurnDispatch,
  Required<
    Pick<ProviderServiceShape, "sendTurn" | "steerTurn" | "startReview" | "startClaudeCompaction">
  >
>()("glade/provider/ProviderTurnDispatch") {}
