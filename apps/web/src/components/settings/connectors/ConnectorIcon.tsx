import { SiteFavicon } from "~/components/SiteFavicon";
import { resolveServiceBrand } from "~/lib/serviceBrandArtwork";
import { cn } from "~/lib/utils";

const TILE_CLASS_NAMES = {
  md: "size-8 rounded-lg [&>*]:size-4.5",
  lg: "size-11 rounded-xl [&>*]:size-6",
} as const;

// Local brand artwork first: monochrome marks follow the text color, so they read on either theme.
// A site favicon is the fallback for custom servers; favicons are drawn for light pages, hence the
// white tile.
export function ConnectorIcon(props: {
  readonly brand: ReadonlyArray<string | null | undefined>;
  readonly url: string;
  readonly size?: "md" | "lg";
}) {
  const artwork = props.brand
    .map((candidate) => resolveServiceBrand(candidate))
    .find((entry) => entry !== undefined);
  const Icon = artwork?.icon;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center border border-[color:var(--color-border)]",
        Icon ? "bg-background text-foreground" : "bg-white text-neutral-500",
        TILE_CLASS_NAMES[props.size ?? "md"],
      )}
    >
      {Icon ? <Icon /> : <SiteFavicon url={props.url} />}
    </span>
  );
}
