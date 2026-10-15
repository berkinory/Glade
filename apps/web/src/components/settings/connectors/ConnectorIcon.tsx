import { SiteFavicon } from "~/components/SiteFavicon";
import { cn } from "~/lib/utils";

const TILE_CLASS_NAMES = {
  md: "size-8 rounded-lg [&>*]:size-4.5",
  lg: "size-11 rounded-xl [&>*]:size-6",
} as const;

export function ConnectorIcon(props: { readonly url: string; readonly size?: "md" | "lg" }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        // Brand favicons are drawn for light pages; a dark tile hides marks like GitHub's.
        "inline-flex shrink-0 items-center justify-center border border-[color:var(--color-border)] bg-white text-neutral-500",
        TILE_CLASS_NAMES[props.size ?? "md"],
      )}
    >
      <SiteFavicon url={props.url} />
    </span>
  );
}
