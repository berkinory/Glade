import { ServiceMap } from "effect";
import type { ProviderServiceShape } from "./ProviderService";
export class ProviderTaskControl extends ServiceMap.Service<
  ProviderTaskControl,
  Required<
    Pick<
      ProviderServiceShape,
      | "interruptTurn"
      | "stopTask"
      | "backgroundTask"
      | "steerSubagent"
      | "respondToRequest"
      | "respondToUserInput"
    >
  >
>()("glade/provider/ProviderTaskControl") {}
