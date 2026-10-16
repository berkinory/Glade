import brandManifest from "@glade/catalog/brands.json";

import { createBrandIcon } from "./createBrandIcon";
import type { IconComponent } from "./iconComponent";
import { Folder02Icon } from "./icons";

interface BrandEntry {
  readonly monochrome?: boolean;
  readonly aliases?: ReadonlyArray<string>;
  readonly badge?: boolean;
  readonly coverage?: number;
}

export interface BrandArtwork {
  readonly icon: IconComponent;
  // The artwork carries its own background and fills a tile edge to edge.
  readonly badge: boolean;
  // How much of its own canvas the glyph covers.
  readonly coverage: number;
}

const manifest: Readonly<Record<string, BrandEntry>> = brandManifest;
const files = import.meta.glob<string>("../../../../packages/catalog/brands/*", {
  query: "?no-inline",
  import: "default",
  eager: true,
});

const BRANDS = new Map<string, BrandArtwork>();
const ALIASES = new Map<string, string>();
for (const [file, url] of Object.entries(files)) {
  const id = file.slice(file.lastIndexOf("/") + 1, file.lastIndexOf("."));
  const entry = manifest[id];
  if (!entry) throw new Error(`Brand artwork ${id} is missing from brands.json.`);
  BRANDS.set(id, {
    icon: createBrandIcon(url, entry.monochrome === true),
    badge: entry.badge === true,
    coverage: entry.coverage ?? 1,
  });
  for (const alias of entry.aliases ?? []) ALIASES.set(alias, id);
}
// Services without a mark of their own.
BRANDS.set("filesystem", { icon: Folder02Icon, badge: false, coverage: 1 });
ALIASES.set("serverfilesystem", "filesystem");

function brandIcon(id: string): IconComponent {
  const brand = BRANDS.get(id);
  if (!brand) throw new Error(`Unknown brand ${id}.`);
  return brand.icon;
}

// Matches an MCP server, connector or service name to its artwork.
export function resolveServiceBrand(value: string | null | undefined): BrandArtwork | undefined {
  const normalized = (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  // Connectors reach agents as `<name>_connector` servers.
  const key = normalized.endsWith("connector")
    ? normalized.slice(0, -"connector".length)
    : normalized;
  return BRANDS.get(ALIASES.get(key) ?? key);
}

export const AndroidStudioIcon = brandIcon("androidstudio");
export const BunIcon = brandIcon("bun");
export const ClaudeIcon = brandIcon("claude");
export const CLionIcon = brandIcon("clion");
export const CursorIcon = brandIcon("cursor");
export const DataGripIcon = brandIcon("datagrip");
export const GhosttyIcon = brandIcon("ghostty");
export const GitHubIcon = brandIcon("github");
export const GoLandIcon = brandIcon("goland");
export const GrokIcon = brandIcon("xaigrok");
export const IntelliJIdeaIcon = brandIcon("intellijidea");
export const Iterm2Icon = brandIcon("iterm2");
export const LinkedInIcon = brandIcon("linkedin");
export const OpenAIIcon = brandIcon("openai");
export const OpenCodeIcon = brandIcon("opencodeai");
export const PhpStormIcon = brandIcon("phpstorm");
export const PyCharmIcon = brandIcon("pycharm");
export const RedditIcon = brandIcon("reddit");
export const RiderIcon = brandIcon("rider");
export const RubyMineIcon = brandIcon("rubymine");
export const SublimeTextIcon = brandIcon("sublimetext");
export const TerminalAppIcon = brandIcon("terminalapp");
export const VSCodeIcon = brandIcon("vscode");
export const VscodiumIcon = brandIcon("vscodium");
export const WarpIcon = brandIcon("warp");
export const WebStormIcon = brandIcon("webstorm");
export const WindsurfIcon = brandIcon("windsurf");
export const XBrandIcon = brandIcon("x");
export const XcodeIcon = brandIcon("xcode");
export const ZedIcon = brandIcon("zed");
