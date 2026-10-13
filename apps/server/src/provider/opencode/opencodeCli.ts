import { PROVIDER_DISPLAY_NAMES } from "@glade/contracts/provider/model";
import type { ProviderCli } from "../core/serverProviderDescriptor.ts";

export const OPENCODE_CLI: ProviderCli = {
  command: "opencode",
  displayName: PROVIDER_DISPLAY_NAMES.opencode,
  // The v2 server API and ACP session lifecycle Glade relies on start at 2.0.
  minimumVersion: "2.0.0",
};
