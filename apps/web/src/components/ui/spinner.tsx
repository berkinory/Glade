import type { ComponentProps } from "react";

import { useMediaQuery } from "~/hooks/useMediaQuery";
import { cn } from "~/lib/utils";
import { DOT_MATRIX_PROFILES, type SpinnerVariant } from "./spinner/dotMatrixFrames";

type SpinnerProps = ComponentProps<"svg"> & { variant?: SpinnerVariant };

export function Spinner({ className, variant = "loading", ...props }: SpinnerProps) {
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const profile = DOT_MATRIX_PROFILES[variant];
  return (
    <svg
      aria-label="Loading"
      role="status"
      width="16"
      height="16"
      {...props}
      viewBox="0 0 20 20"
      fill="currentColor"
      className={cn("inline-block shrink-0", className)}
    >
      {profile.dots.map(({ index, still, values, begin }) => (
        <circle
          key={index}
          cx={2 + (index % 5) * 4}
          cy={2 + Math.floor(index / 5) * 4}
          r="1.35"
          opacity={still}
        >
          {reducedMotion ? null : (
            <animate
              attributeName="opacity"
              values={values}
              keyTimes={profile.keyTimes}
              dur={`${profile.duration}s`}
              begin={begin}
              repeatCount="indefinite"
              calcMode={variant === "subagent" ? "spline" : "discrete"}
              keySplines={
                variant === "subagent"
                  ? "0.42 0 0.58 1;0.42 0 0.58 1;0.42 0 0.58 1;0.42 0 0.58 1"
                  : undefined
              }
            />
          )}
        </circle>
      ))}
    </svg>
  );
}
