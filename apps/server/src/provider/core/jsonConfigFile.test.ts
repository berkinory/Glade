import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as nodePath from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readJsonConfig, removeJsonConfigKey } from "./jsonConfigFile.ts";

describe("agent JSON config files", () => {
  let file: string;

  beforeEach(async () => {
    const directory = await fs.mkdtemp(nodePath.join(os.tmpdir(), "glade-json-config-"));
    file = nodePath.join(directory, "mcp.json");
  });

  afterEach(async () => {
    await fs.rm(nodePath.dirname(file), { recursive: true, force: true });
  });

  it("removes only the named entry and keeps the file's indentation", async () => {
    const config = {
      mcpServers: { exa: { url: "https://mcp.exa.ai/mcp" }, local: { command: "x" } },
      theme: "dark",
    };
    await fs.writeFile(file, `${JSON.stringify(config, null, 4)}\n`);

    await removeJsonConfigKey(file, ["mcpServers", "exa"]);

    expect(await fs.readFile(file, "utf8")).toBe(
      `${JSON.stringify({ mcpServers: { local: { command: "x" } }, theme: "dark" }, null, 4)}\n`,
    );
  });

  it("reads a file with comments but refuses to rewrite it", async () => {
    const source = `{
  // servers
  "mcp": { "servers": { "exa": { "type": "remote", "url": "https://mcp.exa.ai/mcp", }, }, },
}
`;
    await fs.writeFile(file, source);

    expect(await readJsonConfig(file)).toEqual({
      mcp: { servers: { exa: { type: "remote", url: "https://mcp.exa.ai/mcp" } } },
    });
    await expect(removeJsonConfigKey(file, ["mcp", "servers", "exa"])).rejects.toThrow(
      "has comments",
    );
    expect(await fs.readFile(file, "utf8")).toBe(source);
  });
});
