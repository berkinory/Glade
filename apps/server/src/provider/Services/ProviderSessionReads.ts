import { ServiceMap } from "effect";
import type { ProviderServiceShape } from "./ProviderService";
export class ProviderSessionReads extends ServiceMap.Service<
  ProviderSessionReads,
  Required<
    Pick<
      ProviderServiceShape,
      "listSessions" | "getCapabilities" | "rollbackConversation" | "compactThread"
    >
  >
>()("glade/provider/ProviderSessionReads") {}
