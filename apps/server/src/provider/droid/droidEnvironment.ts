import { homedir } from "node:os";
import path from "node:path";

// An API key in FACTORY_API_KEY takes priority over the stored login.
export const DROID_CREDENTIAL_GRANTS: ReadonlySet<string> = new Set(["FACTORY_API_KEY"]);

// Standalone installs otherwise update in-process, a download that Glade's process-tree teardown
// would cut short. Glade's own update action runs `droid update` without this override.
export const DROID_PROCESS_OVERRIDES: NodeJS.ProcessEnv = {
  FACTORY_DROID_AUTO_UPDATE_ENABLED: "false",
};

// Droid reads FACTORY_HOME_OVERRIDE in place of the user's home directory.
export const droidHome = (env: NodeJS.ProcessEnv, homeDir: string) =>
  path.join(env.FACTORY_HOME_OVERRIDE?.trim() || homeDir || env.HOME || homedir(), ".factory");
