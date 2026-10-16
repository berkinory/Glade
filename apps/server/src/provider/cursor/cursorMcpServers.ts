import { homedir } from "node:os";
import path from "node:path";

import { isRecord } from "@glade/shared/transport/payloadValues";
import { configuredMcpServer, type ProviderUserMcpServers } from "../core/configuredMcpServers.ts";
import { readJsonConfig, removeJsonConfigKey } from "../core/jsonConfigFile.ts";

const configPath = () => path.join(homedir(), ".cursor", "mcp.json");

// The Cursor CLI has no command that adds or removes a server; `mcp.json` is the only record.
export const CURSOR_USER_MCP_SERVERS: ProviderUserMcpServers = {
  list: async () => {
    const config = await readJsonConfig(configPath());
    const servers = isRecord(config) && isRecord(config.mcpServers) ? config.mcpServers : {};
    return Object.entries(servers).flatMap(([name, entry]) =>
      isRecord(entry) ? [configuredMcpServer(name, entry.url)] : [],
    );
  },
  remove: ({ name }) => removeJsonConfigKey(configPath(), ["mcpServers", name]),
};
