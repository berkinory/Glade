import type { AcpProviderProfile } from "../acp/acpProviderProfile.ts";
import { OPENCODE_CLI } from "./opencodeCli.ts";
import { opencodeInnerToolCall } from "./opencodeCodeMode.ts";

// OpenCode allows every tool by default. Supervised mode asks for each edit, command, fetch and
// access outside the workspace instead.
const SUPERVISED_PERMISSIONS = JSON.stringify({
  permission: { edit: "ask", bash: "ask", webfetch: "ask", external_directory: "ask" },
});

export const OPENCODE_ACP_PROFILE: AcpProviderProfile = {
  provider: "opencode",
  displayName: OPENCODE_CLI.displayName,
  args: ["acp"],
  env: ({ runtimeMode }) => ({
    // ACP has no request for OpenCode's question tool; without this a question would stall the turn.
    OPENCODE_ENABLE_QUESTION_TOOL: "false",
    ...(runtimeMode === "approval-required"
      ? { OPENCODE_CONFIG_CONTENT: SUPERVISED_PERMISSIONS }
      : {}),
  }),
  sessionConfig: () => [{ configId: "mode", value: "build" }],
  compactCommand: "compact",
  sharesMcpServersAcrossSessions: true,
  innerToolCall: opencodeInnerToolCall,
  hiddenCommands: new Set(),
};
