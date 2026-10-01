import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parse } from "toml";

import {
  GLADE_AGENT_GATEWAY_TOKEN_ENV,
  GLADE_MCP_SERVER_NAME,
} from "../../agentGateway/mcpInjection.ts";
import { resolveBaseCodexHomePath } from "./codexHomePaths.ts";

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function exclusionList(config: unknown): string[] {
  const policy = record(record(config)?.shell_environment_policy);
  const excluded = policy?.exclude;
  if (excluded === undefined) return [];
  if (!Array.isArray(excluded) || excluded.some((value) => typeof value !== "string")) {
    throw new Error("Codex shell_environment_policy.exclude must be a list of names.");
  }
  return excluded;
}

async function readConfig(path: string): Promise<Record<string, unknown> | undefined> {
  let source: string;
  try {
    source = await readFile(path, "utf8");
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw cause;
  }
  const parsed: unknown = parse(source);
  const config = record(parsed);
  if (!config) throw new Error(`Codex config at ${path} is not a TOML table.`);
  return config;
}

function projectConfigPaths(cwd: string): string[] {
  const paths: string[] = [];
  let dir = resolve(cwd);
  while (true) {
    paths.push(join(dir, ".codex", "config.toml"));
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return paths;
}

export async function buildCodexAppServerArgs(input: {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly gatewayEndpointUrl?: string;
}): Promise<string[]> {
  if (!input.gatewayEndpointUrl) return ["app-server"];

  const home = resolveBaseCodexHomePath(input.env);
  const homeConfig = await readConfig(join(home, "config.toml"));
  const profileName = record(homeConfig)?.profile;
  const activeProfile =
    typeof profileName === "string"
      ? record(record(record(homeConfig)?.profiles)?.[profileName])
      : undefined;
  const configs = await Promise.all(projectConfigPaths(input.cwd).map(readConfig));
  const excluded = new Set([
    ...exclusionList(homeConfig),
    ...exclusionList(activeProfile),
    ...configs.flatMap(exclusionList),
    GLADE_AGENT_GATEWAY_TOKEN_ENV,
  ]);
  const endpoint = new URL(input.gatewayEndpointUrl);
  if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") {
    throw new Error("Glade gateway endpoint must use HTTP.");
  }
  const server = `{url=${JSON.stringify(endpoint.toString())}}`;
  return [
    "-c",
    `mcp_servers.${GLADE_MCP_SERVER_NAME}=${server}`,
    "-c",
    `shell_environment_policy.exclude=${JSON.stringify([...excluded].toSorted())}`,
    "app-server",
  ];
}

export type CodexThreadGatewayConfig = Readonly<
  Record<
    string,
    {
      readonly url: string;
      readonly http_headers: { readonly Authorization: string };
    }
  >
>;

export function buildCodexThreadGatewayConfig(connection: {
  readonly url: string;
  readonly bearerToken: string;
}): CodexThreadGatewayConfig {
  return {
    [`mcp_servers.${GLADE_MCP_SERVER_NAME}`]: {
      url: connection.url,
      http_headers: { Authorization: `Bearer ${connection.bearerToken}` },
    },
  };
}
