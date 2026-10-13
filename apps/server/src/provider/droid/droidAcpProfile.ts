import type { AcpProviderProfile } from "../acp/acpProviderProfile.ts";
import { DROID_CLI } from "./droidCli.ts";
import { DROID_PROCESS_OVERRIDES } from "./droidEnvironment.ts";
import { droidModelVendor } from "./droidModels.ts";

export const DROID_ACP_PROFILE: AcpProviderProfile = {
  provider: "factoryDroid",
  displayName: DROID_CLI.displayName,
  args: ["exec", "--output-format", "acp"],
  env: () => DROID_PROCESS_OVERRIDES,
  // Droid's lowest autonomy runs read-only operations on its own and asks before anything else, so
  // Supervised approvals reach Glade; spec mode is read-only planning and is never selected.
  sessionConfig: ({ runtimeMode }) => [
    { configId: "autonomy_level", value: runtimeMode === "full-access" ? "auto-high" : "normal" },
  ],
  titleModel: "gpt-6-luna",
  modelVendor: droidModelVendor,
  // Glade owns chat history, and workstreams belong to Factory's own platform.
  hiddenCommands: new Set(["session-navigation", "detect-overlapping-workstreams"]),
};
