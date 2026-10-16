import * as fs from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import { isRecord } from "@glade/shared/transport/payloadValues";
import { parse } from "toml";

import { runProcess } from "../../platform/processRunner.ts";
import { configuredMcpServer, type ProviderUserMcpServers } from "../core/configuredMcpServers.ts";
import { GROK_CLI } from "./grokCli.ts";
import { grokHome } from "./grokEnvironment.ts";

async function readConfig(): Promise<unknown> {
  try {
    return parse(
      await fs.readFile(path.join(grokHome(process.env, homedir()), "config.toml"), "utf8"),
    );
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw cause;
  }
}

// Only Grok's own servers: those it imports from Claude's and Cursor's settings are listed, and
// removed, through those agents.
export const GROK_USER_MCP_SERVERS: ProviderUserMcpServers = {
  list: async () => {
    const config = await readConfig();
    const servers = isRecord(config) && isRecord(config.mcp_servers) ? config.mcp_servers : {};
    return Object.entries(servers).flatMap(([name, entry]) =>
      isRecord(entry)
        ? [
            configuredMcpServer(
              name,
              entry.url,
              entry.enabled === false ? "Disabled in Grok" : null,
            ),
          ]
        : [],
    );
  },
  remove: async ({ name, binaryPath }) => {
    const result = await runProcess(
      binaryPath ?? GROK_CLI.command,
      ["mcp", "remove", "-s", "user", name],
      { allowNonZeroExit: true, timeoutMs: 30_000 },
    );
    if (result.code !== 0) {
      throw new Error(result.stderr.trim() || `Grok could not remove ${name}.`);
    }
  },
};
