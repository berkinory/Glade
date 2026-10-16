import { homedir } from "node:os";
import path from "node:path";

import { isRecord } from "@glade/shared/transport/payloadValues";
import { runProcess } from "../../platform/processRunner.ts";
import { configuredMcpServer, type ProviderUserMcpServers } from "../core/configuredMcpServers.ts";
import { readJsonConfig } from "../core/jsonConfigFile.ts";

// Claude Code keeps user-scoped MCP servers in `.claude.json`: next to the config directory it
// names with CLAUDE_CONFIG_DIR, otherwise in the home directory.
function claudeGlobalConfigPath(): string {
  const configDir = process.env.CLAUDE_CONFIG_DIR?.trim();
  return configDir ? path.join(configDir, ".claude.json") : path.join(homedir(), ".claude.json");
}

// Only the user scope: project-scoped servers differ per folder, and servers from claude.ai
// connectors or plugins are resolved by Claude Code at runtime rather than written here.
export const CLAUDE_USER_MCP_SERVERS: ProviderUserMcpServers = {
  list: async () => {
    const config = await readJsonConfig(claudeGlobalConfigPath());
    const servers = isRecord(config) && isRecord(config.mcpServers) ? config.mcpServers : {};
    return Object.entries(servers).flatMap(([name, entry]) =>
      isRecord(entry) && name.trim() ? [configuredMcpServer(name, entry.url)] : [],
    );
  },
  remove: async ({ name, binaryPath }) => {
    const result = await runProcess(binaryPath ?? "claude", ["mcp", "remove", "-s", "user", name], {
      allowNonZeroExit: true,
      timeoutMs: 30_000,
    });
    if (result.code !== 0) {
      throw new Error(result.stderr.trim() || `Claude Code could not remove ${name}.`);
    }
  },
};
