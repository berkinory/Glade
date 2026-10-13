import { homedir } from "node:os";
import path from "node:path";

export const GROK_CREDENTIAL_GRANTS: ReadonlySet<string> = new Set(["XAI_API_KEY"]);

export const grokHome = (env: NodeJS.ProcessEnv, homeDir: string) =>
  env.GROK_HOME?.trim() || path.join(homeDir || env.HOME || homedir(), ".grok");
