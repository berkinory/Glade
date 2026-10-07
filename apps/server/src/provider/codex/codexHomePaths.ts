import { homedir } from "node:os";
import path from "node:path";

export interface CodexHomePathsInput {
  readonly env?: NodeJS.ProcessEnv;
  readonly homePath?: string;
}

export function resolveBaseCodexHomePath(
  env: NodeJS.ProcessEnv,
  explicitHomePath?: string,
): string {
  return explicitHomePath?.trim() || env.CODEX_HOME?.trim() || path.join(homedir(), ".codex");
}

export function resolveCodexHomeAllowlistCandidates(
  input: CodexHomePathsInput = {},
): readonly string[] {
  return [resolveBaseCodexHomePath(input.env ?? process.env, input.homePath)];
}
