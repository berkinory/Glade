import type { ProviderMcpServer } from "@glade/contracts/provider/providerDiscovery";

// The MCP servers an agent keeps in its own user configuration.
export interface ProviderUserMcpServers {
  readonly list: () => Promise<ProviderMcpServer[]>;
  readonly remove: (input: {
    readonly name: string;
    readonly binaryPath: string | undefined;
  }) => Promise<void>;
}

function originOf(url: unknown): string | null {
  if (typeof url !== "string") return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

// A server read from a config file, which says nothing about whether it connects.
export function configuredMcpServer(
  name: string,
  url: unknown,
  detail: string | null = null,
): ProviderMcpServer {
  const origin = originOf(url);
  return {
    name,
    transport: origin ? "http" : "local",
    origin,
    status: "configured",
    toolCount: null,
    detail,
  };
}
