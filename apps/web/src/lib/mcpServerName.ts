import { presets } from "@glade/catalog/mcp-servers.json";

// Mirrors the server's connector naming: agents see a connector named "Hugging Face" as
// `hugging_face_connector`, or `hugging_face_2_connector` when that name is already taken.
function connectorSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .slice(0, 40);
}

const PRESET_NAMES = new Map(presets.map((preset) => [connectorSlug(preset.name), preset.name]));

// Returns the catalog name for a known connector, or the bare slug for any other connector.
export function resolveConnectorServer(
  server: string,
): { readonly known: string } | { readonly slug: string } | null {
  const slug = /^(.+?)(?:_\d+)?_connector$/u.exec(server.trim())?.[1];
  if (!slug) return null;
  const known = PRESET_NAMES.get(slug.toLowerCase());
  return known ? { known } : { slug };
}
