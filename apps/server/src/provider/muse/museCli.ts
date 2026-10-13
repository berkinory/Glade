import { PROVIDER_DISPLAY_NAMES } from "@glade/contracts/provider/model";
import type { ProviderCli } from "../core/serverProviderDescriptor.ts";

export const MUSE_CLI: ProviderCli = {
  command: "muse",
  displayName: PROVIDER_DISPLAY_NAMES.museCode,
  // The MSP v1 surface Glade reads was verified against 1.4.7.
  minimumVersion: "1.4.7",
};
