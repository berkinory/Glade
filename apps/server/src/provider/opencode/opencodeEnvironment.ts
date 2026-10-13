import { homedir } from "node:os";
import path from "node:path";

export const opencodeDataHome = (env: NodeJS.ProcessEnv, homeDir: string) =>
  path.join(
    env.XDG_DATA_HOME?.trim() || path.join(homeDir || env.HOME || homedir(), ".local", "share"),
    "opencode",
  );
