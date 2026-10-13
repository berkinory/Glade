import type { AcpProviderProfile } from "../acp/acpProviderProfile.ts";
import { GROK_CLI } from "./grokCli.ts";

export const GROK_ACP_PROFILE: AcpProviderProfile = {
  provider: "grok",
  displayName: GROK_CLI.displayName,
  // A private agent process instead of the shared leader, so Glade owns its lifetime and teardown.
  args: ["agent", "--no-leader", "stdio"],
  hiddenCommands: new Set(["goal", "loop", "workflow", "deep-research", "always-approve"]),
};
