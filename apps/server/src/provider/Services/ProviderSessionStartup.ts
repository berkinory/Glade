import { ServiceMap } from "effect";
import type { ProviderServiceShape } from "./ProviderService";
export class ProviderSessionStartup extends ServiceMap.Service<
  ProviderSessionStartup,
  Required<
    Pick<
      ProviderServiceShape,
      "startSession" | "startSessionWithOutcome" | "completePriorTranscriptBootstrap"
    >
  >
>()("glade/provider/ProviderSessionStartup") {}
