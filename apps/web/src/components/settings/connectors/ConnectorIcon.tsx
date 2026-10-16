import type { McpCatalogIcon } from "@glade/contracts/server/mcpCatalog";
import type { CSSProperties } from "react";

import { SiteFavicon } from "~/components/SiteFavicon";
import { resolveServiceBrand } from "~/lib/brandIcons";
import { BrandImage } from "~/lib/createBrandIcon";
import { cn } from "~/lib/utils";

const TILE_CLASS_NAMES = {
  md: "size-8 rounded-lg",
  lg: "size-11 rounded-xl",
} as const;

// Share of the tile a glyph occupies, so marks of every shape read at the same size.
const GLYPH_SHARE = 0.6;
const MAX_GLYPH_SHARE = 0.86;

// Every connector sits on the same white tile, the way app icons do, so artwork drawn for light
// pages reads on either theme and monochrome marks are drawn dark. Catalog presets bring their own
// artwork; other servers are matched to a bundled brand by name.
export function ConnectorIcon(props: {
  readonly icon: McpCatalogIcon | undefined;
  readonly name: string;
  readonly url: string;
  readonly size?: "md" | "lg";
}) {
  const brand = props.icon ? undefined : resolveServiceBrand(props.name);
  const badge = props.icon?.badge ?? brand?.badge ?? false;
  const coverage = props.icon?.coverage ?? brand?.coverage ?? 1;
  const share = Math.min(GLYPH_SHARE / coverage, MAX_GLYPH_SHARE);
  const glyph = badge
    ? { className: "size-full" }
    : { style: { width: `${share * 100}%`, height: `${share * 100}%` } satisfies CSSProperties };
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden border border-black/10 bg-white text-neutral-900",
        TILE_CLASS_NAMES[props.size ?? "md"],
      )}
    >
      {props.icon ? (
        <BrandImage
          source={props.icon.src}
          monochrome={props.icon.monochrome === true}
          {...glyph}
        />
      ) : brand ? (
        <brand.icon {...glyph} />
      ) : (
        <SiteFavicon url={props.url} className="size-[60%]" />
      )}
    </span>
  );
}
