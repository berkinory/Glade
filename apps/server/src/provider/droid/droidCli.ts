import { PROVIDER_DISPLAY_NAMES } from "@glade/contracts/provider/model";
import type { ProviderCli } from "../core/serverProviderDescriptor.ts";

export const DROID_CLI: ProviderCli = {
  command: "droid",
  displayName: PROVIDER_DISPLAY_NAMES.factoryDroid,
  minimumVersion: "0.240.0",
};
