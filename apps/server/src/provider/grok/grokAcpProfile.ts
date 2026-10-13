import type { AcpProviderProfile } from "../acp/acpProviderProfile.ts";
import { GROK_CLI } from "./grokCli.ts";

// A private agent process instead of the shared leader, so Glade owns its lifetime and teardown.
const AGENT_ARGS = ["agent", "--no-leader", "stdio"];

export const GROK_ACP_PROFILE: AcpProviderProfile = {
  provider: "grok",
  displayName: GROK_CLI.displayName,
  args: AGENT_ARGS,
  titleModel: "grok-4.7-build-fast",
  compactCommand: "compact",
  // Grok reads a first-prompt policy as an injected instruction and refuses it.
  argsWithSystemPrompt: (policy) => ["--rules", policy, ...AGENT_ARGS],
  hiddenCommands: new Set(["goal", "loop", "workflow", "deep-research", "always-approve"]),
};
