import type { ComponentProps, ReactNode } from "react";

import { useMediaQuery } from "~/hooks/useMediaQuery";
import { cn } from "~/lib/utils";

type SpinnerVariant = "action" | "loading" | "working" | "subagent" | "voice";

type SpinnerProps = ComponentProps<"svg"> & { variant?: SpinnerVariant };

const EASE = "0.65 0 0.35 1";
const STEP_EASE = "0.7 0 0.3 1";
const LINEAR = "0 0 1 1";
const ARC_CIRCUMFERENCE = 2 * Math.PI * 9;

function splines(...curves: string[]): Pick<ComponentProps<"animate">, "calcMode" | "keySplines"> {
  return { calcMode: "spline", keySplines: curves.join(";") };
}

function growingArc(animate: boolean): ReactNode {
  const gap = ARC_CIRCUMFERENCE;
  return (
    <g stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <circle r="9" strokeOpacity="0.14" />
      <g>
        <circle r="9" strokeDasharray={`${gap / 4} ${gap}`}>
          {animate && (
            <>
              <animate
                attributeName="stroke-dasharray"
                values={`${gap * 0.03} ${gap};${gap * 0.62} ${gap};${gap * 0.03} ${gap}`}
                keyTimes="0;0.5;1"
                dur="1.4s"
                repeatCount="indefinite"
                {...splines("0.42 0 0.58 1", "0.42 0 0.58 1")}
              />
              <animate
                attributeName="stroke-dashoffset"
                values={`0;${-gap * 0.14};${-gap * 0.97}`}
                keyTimes="0;0.5;1"
                dur="1.4s"
                repeatCount="indefinite"
                {...splines("0.42 0 0.58 1", "0.42 0 0.58 1")}
              />
            </>
          )}
        </circle>
        {animate && (
          <animateTransform
            attributeName="transform"
            type="rotate"
            values="0;360"
            dur="1.4s"
            repeatCount="indefinite"
          />
        )}
      </g>
    </g>
  );
}

const FOLD_SQUARES = [
  { x: -9, y: -9, inward: "3 3", opacity: 1 },
  { x: 1, y: -9, inward: "-3 3", opacity: 0.7 },
  { x: -9, y: 1, inward: "3 -3", opacity: 0.7 },
  { x: 1, y: 1, inward: "-3 -3", opacity: 0.45 },
];

function foldingGrid(animate: boolean): ReactNode {
  return (
    <g fill="currentColor">
      {FOLD_SQUARES.map(({ x, y, inward, opacity }) => (
        <rect key={`${x},${y}`} x={x} y={y} width="8" height="8" rx="1.4" opacity={opacity}>
          {animate && (
            <>
              <animateTransform
                attributeName="transform"
                type="translate"
                values={`0 0;${inward};${inward};0 0`}
                keyTimes="0;0.45;0.55;1"
                dur="1.8s"
                repeatCount="indefinite"
                {...splines(EASE, LINEAR, EASE)}
              />
              <animate
                attributeName="rx"
                values="1.4;0.4;0.4;1.4"
                keyTimes="0;0.45;0.55;1"
                dur="1.8s"
                repeatCount="indefinite"
                {...splines(EASE, LINEAR, EASE)}
              />
            </>
          )}
        </rect>
      ))}
      {animate && (
        // Accumulating keeps each quarter turn from snapping back when the cycle repeats.
        <animateTransform
          attributeName="transform"
          type="rotate"
          values="0;0;90;90"
          keyTimes="0;0.45;0.55;1"
          dur="3.6s"
          repeatCount="indefinite"
          accumulate="sum"
          {...splines(LINEAR, EASE, LINEAR)}
        />
      )}
    </g>
  );
}

function morphingSquare(animate: boolean): ReactNode {
  return (
    <rect x="-7" y="-7" width="14" height="14" rx="1.5" stroke="currentColor" strokeWidth="2.5">
      {animate && (
        <>
          <animateTransform
            attributeName="transform"
            type="rotate"
            values="0;180;360"
            keyTimes="0;0.5;1"
            dur="1.6s"
            repeatCount="indefinite"
            {...splines(EASE, EASE)}
          />
          <animateTransform
            attributeName="transform"
            type="scale"
            values="1;0.7;1"
            keyTimes="0;0.5;1"
            dur="1.6s"
            repeatCount="indefinite"
            additive="sum"
            {...splines(EASE, EASE)}
          />
          <animate
            attributeName="rx"
            values="1.5;7;1.5"
            keyTimes="0;0.5;1"
            dur="1.6s"
            repeatCount="indefinite"
            {...splines(EASE, EASE)}
          />
        </>
      )}
    </rect>
  );
}

function triangleOrbit(animate: boolean): ReactNode {
  return (
    <g fill="currentColor">
      {[1, 0.68, 0.42].map((opacity, index) => (
        <g key={opacity} transform={`rotate(${index * 120})`}>
          <circle cy="-7" r="3.4" opacity={opacity}>
            {/* One tuck per 120 degree step: dots pull inward while moving and rest on the rim. */}
            {animate && (
              <>
                <animate
                  attributeName="cy"
                  values="-7;-3.8;-7"
                  keyTimes="0;0.5;1"
                  dur="0.6s"
                  repeatCount="indefinite"
                  {...splines(STEP_EASE, STEP_EASE)}
                />
                <animate
                  attributeName="r"
                  values="3.4;2.4;3.4"
                  keyTimes="0;0.5;1"
                  dur="0.6s"
                  repeatCount="indefinite"
                  {...splines(STEP_EASE, STEP_EASE)}
                />
              </>
            )}
          </circle>
        </g>
      ))}
      {animate && (
        <animateTransform
          attributeName="transform"
          type="rotate"
          values="0;120;240;360"
          keyTimes="0;0.3333;0.6667;1"
          dur="1.8s"
          repeatCount="indefinite"
          {...splines(STEP_EASE, STEP_EASE, STEP_EASE)}
        />
      )}
    </g>
  );
}

function stretchingPills(animate: boolean): ReactNode {
  return (
    <g fill="currentColor">
      {[-10.5, -2.75, 5].map((x, index) => (
        <rect key={x} x={x} y="-2.75" width="5.5" height="5.5" rx="2.75" opacity="0.38">
          {animate &&
            (
              [
                ["height", "5.5;15;5.5;5.5"],
                ["y", "-2.75;-7.5;-2.75;-2.75"],
                ["opacity", "0.38;1;0.38;0.38"],
              ] as const
            ).map(([attributeName, values]) => (
              <animate
                key={attributeName}
                attributeName={attributeName}
                values={values}
                keyTimes="0;0.35;0.7;1"
                dur="1.2s"
                begin={`${index * 0.12 - 1.2}s`}
                repeatCount="indefinite"
                {...splines(EASE, EASE, LINEAR)}
              />
            ))}
        </rect>
      ))}
    </g>
  );
}

const GLYPHS: Record<SpinnerVariant, (animate: boolean) => ReactNode> = {
  action: growingArc,
  loading: foldingGrid,
  working: morphingSquare,
  subagent: triangleOrbit,
  voice: stretchingPills,
};

export function Spinner({ className, variant = "loading", ...props }: SpinnerProps) {
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  return (
    <svg
      aria-label="Loading"
      role="status"
      width="16"
      height="16"
      {...props}
      viewBox="-12 -12 24 24"
      fill="none"
      className={cn("inline-block shrink-0", className)}
    >
      {GLYPHS[variant](!reducedMotion)}
    </svg>
  );
}
