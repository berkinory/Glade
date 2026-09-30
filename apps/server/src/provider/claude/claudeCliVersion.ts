import { compareSemverVersions } from "../core/providerMaintenance.ts";

export const MINIMUM_CLAUDE_AUTO_MODE_CLI_VERSION = "2.1.111";

export function isClaudeAutoModeCliVersionSupported(version: string | null): boolean {
  return (
    version !== null && compareSemverVersions(version, MINIMUM_CLAUDE_AUTO_MODE_CLI_VERSION) >= 0
  );
}
