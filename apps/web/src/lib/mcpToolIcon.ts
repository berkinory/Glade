import type { IconComponent } from "./iconComponent";
import { resolveServiceBrand } from "./serviceBrandArtwork";

export function resolveMcpToolIcon(input: {
  toolName?: string | undefined;
  mcpService?: string | undefined;
}): IconComponent | null {
  const serviceBrand = resolveServiceBrand(input.mcpService);
  if (serviceBrand) return serviceBrand.icon;
  const name = input.toolName?.trim().toLowerCase() ?? "";
  const match = /^mcp__(.+?)__([a-z0-9_.-]+)$/.exec(name);
  const server = match?.[1] ?? input.mcpService?.trim().toLowerCase();
  const tool = match?.[2] ?? name;
  const serverBrand = resolveServiceBrand(server);
  if (serverBrand) return serverBrand.icon;
  if (server !== "codex_apps") return null;
  const segments = tool.split("_");
  for (let count = 1; count <= segments.length; count += 1) {
    const brand = resolveServiceBrand(segments.slice(0, count).join("_"));
    if (brand) return brand.icon;
  }
  return null;
}
