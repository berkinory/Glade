import type { AcpProviderProfile } from "../acp/acpProviderProfile.ts";
import { CURSOR_CLI } from "./cursorCli.ts";

export const CURSOR_ACP_PROFILE: AcpProviderProfile = {
  provider: "cursor",
  displayName: CURSOR_CLI.displayName,
  args: ["acp"],
  authMethodId: "cursor_login",
  sessionConfig: () => [{ configId: "mode", value: "agent" }],
  hiddenCommands: new Set(["goal", "loop", "autopilot"]),
};
