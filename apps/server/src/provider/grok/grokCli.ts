import { PROVIDER_DISPLAY_NAMES } from "@glade/contracts/provider/model";
import type { ProviderCli } from "../core/serverProviderDescriptor.ts";

export const GROK_CLI: ProviderCli = {
  command: "grok",
  displayName: PROVIDER_DISPLAY_NAMES.grok,
  minimumVersion: "1.0.0",
};
