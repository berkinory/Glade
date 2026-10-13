import { PROVIDER_DISPLAY_NAMES } from "@glade/contracts/provider/model";
import type { ProviderCli } from "../core/serverProviderDescriptor.ts";

export const CLAUDE_CLI: ProviderCli = {
  command: "claude",
  displayName: PROVIDER_DISPLAY_NAMES.claudeAgent,
  // Snapshot reads require this CLI version; the SDK build manifest alone does not cover them.
  minimumVersion: "2.1.267",
};
