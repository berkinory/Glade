import { useId } from "react";
import type { IconComponent, IconProps } from "./iconComponent";
import { cn } from "./utils";

// Monochrome artwork is drawn as a mask in the surrounding text color.
export function BrandImage({
  source,
  monochrome = false,
  size = 16,
  filled: _filled,
  className,
  ...props
}: IconProps & { readonly source: string; readonly monochrome?: boolean }) {
  const maskId = useId();
  const label = props["aria-label"];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 1 1"
      xmlns="http://www.w3.org/2000/svg"
      role={label ? "img" : undefined}
      aria-hidden={label ? undefined : true}
      className={cn("shrink-0", className)}
      {...props}
    >
      {monochrome ? (
        <>
          <defs>
            <mask id={maskId} style={{ maskType: "alpha" }}>
              <image href={source} width="1" height="1" />
            </mask>
          </defs>
          <rect width="1" height="1" fill="currentColor" mask={`url(#${maskId})`} />
        </>
      ) : (
        <image href={source} width="1" height="1" />
      )}
    </svg>
  );
}

export function createBrandIcon(source: string, monochrome = false): IconComponent {
  return function BrandIcon(props) {
    return <BrandImage source={source} monochrome={monochrome} {...props} />;
  };
}
