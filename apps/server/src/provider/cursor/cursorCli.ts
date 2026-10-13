import { PROVIDER_DISPLAY_NAMES } from "@glade/contracts/provider/model";
import type { ProviderCli } from "../core/serverProviderDescriptor.ts";

export const CURSOR_CLI: ProviderCli = {
  // Installers for other agents also claim the bare `agent` name, so Glade uses the specific one.
  command: "cursor-agent",
  displayName: PROVIDER_DISPLAY_NAMES.cursor,
  minimumVersion: "2026.1.0",
};
