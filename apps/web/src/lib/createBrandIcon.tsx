import { useId } from "react";
import type { IconComponent } from "./iconComponent";
import { cn } from "./utils";

export function createBrandIcon(source: string, monochrome = false): IconComponent {
  return function BrandIcon({ size = 16, filled: _filled, className, ...props }) {
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
        className={cn("size-4 shrink-0", className)}
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
  };
}
