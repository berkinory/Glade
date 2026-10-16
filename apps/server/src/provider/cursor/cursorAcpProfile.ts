import type { AcpProviderProfile } from "../acp/acpProviderProfile.ts";
import { CURSOR_CLI } from "./cursorCli.ts";
import { cursorModelVendor, describeCursorModels } from "./cursorModels.ts";
import { CURSOR_USER_MCP_SERVERS } from "./cursorMcpServers.ts";

export const CURSOR_ACP_PROFILE: AcpProviderProfile = {
  provider: "cursor",
  displayName: CURSOR_CLI.displayName,
  args: ["acp"],
  authMethodId: "cursor_login",
  sessionConfig: () => [{ configId: "mode", value: "agent" }],
  savesModelChoiceGlobally: true,
  // Cursor offers each model parameter as its own option only to clients that ask; otherwise every
  // model is one fixed variant with its settings folded into the id.
  clientMeta: { parameterizedModelPicker: true },
  describeModels: describeCursorModels,
  modelVendor: cursorModelVendor,
  userMcpServers: CURSOR_USER_MCP_SERVERS,
  hiddenCommands: new Set(["goal", "loop", "autopilot"]),
};
