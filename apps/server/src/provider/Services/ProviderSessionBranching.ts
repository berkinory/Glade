import { ServiceMap } from "effect";
import type { ProviderServiceShape } from "./ProviderService";
export class ProviderSessionBranching extends ServiceMap.Service<
  ProviderSessionBranching,
  Required<Pick<ProviderServiceShape, "forkThread">>
>()("glade/provider/ProviderSessionBranching") {}
