import { ServiceMap } from "effect";
import type { ProviderServiceShape } from "./ProviderService.ts";

export class ProviderNativeHistory extends ServiceMap.Service<
  ProviderNativeHistory,
  Pick<ProviderServiceShape, "updateNativeHistory">
>()("glade/provider/Services/ProviderNativeHistory") {}
