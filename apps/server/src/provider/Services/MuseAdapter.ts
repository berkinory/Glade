import { ServiceMap } from "effect";

import type { ProviderAdapterError } from "../core/Errors.ts";
import type { ProviderAdapterShape } from "./ProviderAdapter.ts";

export class MuseAdapter extends ServiceMap.Service<
  MuseAdapter,
  ProviderAdapterShape<ProviderAdapterError>
>()("glade/provider/Services/MuseAdapter") {}
