import { ServiceMap } from "effect";

import type { ProviderAdapterError } from "../core/Errors.ts";
import type { ProviderAdapterShape } from "./ProviderAdapter.ts";

// One adapter per built-in provider that speaks the Agent Client Protocol.
export class AcpAdapters extends ServiceMap.Service<
  AcpAdapters,
  ReadonlyArray<ProviderAdapterShape<ProviderAdapterError>>
>()("glade/provider/Services/AcpAdapters") {}
