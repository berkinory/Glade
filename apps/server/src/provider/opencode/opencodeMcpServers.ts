import { homedir } from "node:os";
import path from "node:path";

import { isRecord } from "@glade/shared/transport/payloadValues";
import { configuredMcpServer, type ProviderUserMcpServers } from "../core/configuredMcpServers.ts";
import { readJsonConfig, removeJsonConfigKey } from "../core/jsonConfigFile.ts";

// OpenCode merges every global config file it finds.
const CONFIG_FILES = ["config.json", "opencode.json", "opencode.jsonc"];

interface ConfigEntry {
  readonly file: string;
  readonly keyPath: ReadonlyArray<string>;
  readonly name: string;
  readonly value: Record<string, unknown>;
}

function opencodeConfigDir(): string {
  const configHome = process.env.XDG_CONFIG_HOME?.trim() || path.join(homedir(), ".config");
  return path.join(configHome, "opencode");
}

// Version 2 nests servers under `mcp.servers`; version 1 keyed them directly under `mcp` and
// is still read.
function entriesOf(file: string, config: unknown): ConfigEntry[] {
  const mcp = isRecord(config) && isRecord(config.mcp) ? config.mcp : {};
  const nested = isRecord(mcp.servers) ? mcp.servers : {};
  const entries: ConfigEntry[] = [];
  for (const [name, value] of Object.entries(nested)) {
    if (isRecord(value)) entries.push({ file, keyPath: ["mcp", "servers", name], name, value });
  }
  for (const [name, value] of Object.entries(mcp)) {
    if (name !== "servers" && isRecord(value) && "type" in value) {
      entries.push({ file, keyPath: ["mcp", name], name, value });
    }
  }
  return entries;
}

async function readEntries(): Promise<ConfigEntry[]> {
  const directory = opencodeConfigDir();
  const files = await Promise.all(
    CONFIG_FILES.map(async (name) => {
      const file = path.join(directory, name);
      return entriesOf(file, await readJsonConfig(file));
    }),
  );
  return files.flat();
}

export const OPENCODE_USER_MCP_SERVERS: ProviderUserMcpServers = {
  list: async () => {
    const seen = new Set<string>();
    return (await readEntries()).flatMap((entry) => {
      if (seen.has(entry.name)) return [];
      seen.add(entry.name);
      const disabled = entry.value.disabled === true || entry.value.enabled === false;
      return [
        configuredMcpServer(entry.name, entry.value.url, disabled ? "Disabled in OpenCode" : null),
      ];
    });
  },
  // OpenCode has no command that removes a server, so the entry leaves its config file.
  remove: async ({ name }) => {
    for (const entry of await readEntries()) {
      if (entry.name === name) await removeJsonConfigKey(entry.file, entry.keyPath);
    }
  },
};
