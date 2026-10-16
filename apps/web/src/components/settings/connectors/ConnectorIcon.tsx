import type { CSSProperties } from "react";

import { SiteFavicon } from "~/components/SiteFavicon";
import { resolveServiceBrand } from "~/lib/serviceBrandArtwork";
import { cn } from "~/lib/utils";

const TILE_CLASS_NAMES = {
  md: "size-8 rounded-lg",
  lg: "size-11 rounded-xl",
} as const;

// Share of the tile a glyph occupies, so marks of every shape read at the same size.
const GLYPH_SHARE = 0.6;
const MAX_GLYPH_SHARE = 0.86;

// Measured from the artwork itself. Badges carry their own background and fill the tile edge to
// edge instead of sitting as a smaller square inside it.
const BADGE_ARTWORK = new Set([
  "context7",
  "exa",
  "clickhouse",
  "mongodb",
  "netlify",
  "fly",
  "honeycomb",
  "tavily",
  "brightdata",
  "fal",
  "canva",
  "miro",
  "21st-dev",
  "todoist",
  "circleback",
  "intercom",
  "intercom-eu",
  "ramp",
  "zapier",
  "autumn",
  "customerio",
  "customerio-eu",
  "dodopayments",
  "eachlabs",
  "openseo",
  "postman",
  "wiro",
]);

// How much of its own canvas a padded glyph covers; it is enlarged to match the others.
const GLYPH_COVERAGE: Readonly<Record<string, number>> = {
  apify: 0.86,
  render: 0.5,
  resend: 0.5,
  sanity: 0.73,
  mixpanel: 0.76,
  braintrust: 0.78,
  perplexity: 0.83,
  stripe: 0.88,
  ahrefs: 0.88,
};

// Every connector sits on the same white tile, the way app icons do, so artwork drawn for light
// pages reads on either theme and monochrome marks are drawn dark.
export function ConnectorIcon(props: {
  readonly presetId: string | null;
  readonly name: string;
  readonly url: string;
  readonly size?: "md" | "lg";
}) {
  const Icon = (resolveServiceBrand(props.presetId) ?? resolveServiceBrand(props.name))?.icon;
  const badge = Icon !== undefined && props.presetId !== null && BADGE_ARTWORK.has(props.presetId);
  const share = Math.min(
    GLYPH_SHARE / (props.presetId ? (GLYPH_COVERAGE[props.presetId] ?? 1) : 1),
    MAX_GLYPH_SHARE,
  );
  const glyphStyle: CSSProperties = { width: `${share * 100}%`, height: `${share * 100}%` };
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden border border-black/10 bg-white text-neutral-900",
        TILE_CLASS_NAMES[props.size ?? "md"],
      )}
    >
      {Icon ? (
        <Icon className={badge ? "size-full" : undefined} style={badge ? undefined : glyphStyle} />
      ) : (
        <SiteFavicon url={props.url} className="size-[60%]" />
      )}
    </span>
  );
}
