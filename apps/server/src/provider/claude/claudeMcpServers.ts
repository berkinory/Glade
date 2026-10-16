import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import type { ProviderMcpServer } from "@glade/contracts/provider/providerDiscovery";
import { isRecord } from "@glade/shared/transport/payloadValues";

// Claude Code keeps user-scoped MCP servers in `.claude.json`: next to the config directory it
// names with CLAUDE_CONFIG_DIR, otherwise in the home directory.
function claudeGlobalConfigPath(): string {
  const configDir = process.env.CLAUDE_CONFIG_DIR?.trim();
  return configDir ? path.join(configDir, ".claude.json") : path.join(homedir(), ".claude.json");
}

function originOf(url: unknown): string | null {
  if (typeof url !== "string") return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

// Only the user scope: project-scoped servers differ per folder, and servers from claude.ai
// connectors or plugins are resolved by Claude Code at runtime rather than written here.
export async function readClaudeUserMcpServers(): Promise<ProviderMcpServer[]> {
  let source: string;
  try {
    source = await readFile(claudeGlobalConfigPath(), "utf8");
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw cause;
  }
  const config: unknown = JSON.parse(source);
  const servers = isRecord(config) && isRecord(config.mcpServers) ? config.mcpServers : {};
  return Object.entries(servers).flatMap(([name, entry]): ProviderMcpServer[] => {
    if (!isRecord(entry) || !name.trim()) return [];
    const origin = originOf(entry.url);
    return [
      {
        name,
        transport: origin ? "http" : "local",
        origin,
        status: "configured",
        toolCount: null,
        detail: null,
      },
    ];
  });
}
