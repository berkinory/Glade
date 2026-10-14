import type { ComponentProps, CSSProperties, ReactNode } from "react";

import { cn } from "~/lib/utils";

type SpinnerVariant = "action" | "loading" | "subagent" | "voice";

type SpinnerProps = ComponentProps<"span"> & { variant?: SpinnerVariant };

// Every moving part is a full-size layer that animates only transform and opacity, so the compositor
// runs the motion without main-thread frames. Animating SVG attributes instead made Chromium restyle,
// lay out and repaint the whole document every frame for as long as any spinner stayed visible.
// Full-size layers also make translate percentages read as 1/24ths of the viewBox.
function Layer(props: { className?: string; style?: CSSProperties; children: ReactNode }) {
  return (
    <span className={cn("absolute inset-0 block", props.className)} style={props.style}>
      {props.children}
    </span>
  );
}

function Glyph({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="-12 -12 24 24" fill="none" className="block size-full overflow-visible">
      {children}
    </svg>
  );
}

// The arc grows from its tail through two clipped semicircles: one turns into the half box that
// starts at the tail and covers the first half turn of length, the other covers the rest. Half-disk
// caps keep the round ends without overlapping the stroke, and adding the pieces inside an isolated
// group keeps their seams at full color with translucent colors. The keyframes split the original
// eased length at half a turn, so the motion matches the earlier stroke-dash animation.
function ArcHalf(props: { side: "top" | "bottom"; className: string; d: string }) {
  const edge = props.side === "top" ? "top-0" : "bottom-0";
  return (
    <span className={cn("absolute inset-x-0 h-1/2 overflow-hidden", edge)}>
      <span className={cn("absolute inset-x-0 h-[200%]", edge)}>
        <Layer className={cn("mix-blend-plus-lighter", props.className)}>
          <Glyph>
            <path d={props.d} stroke="currentColor" strokeWidth="2.5" />
          </Glyph>
        </Layer>
      </span>
    </span>
  );
}

function growingArc(): ReactNode {
  return (
    <>
      <Layer>
        <Glyph>
          <circle r="9" stroke="currentColor" strokeWidth="2.5" strokeOpacity="0.14" />
        </Glyph>
      </Layer>
      <Layer className="spinner-action-spin">
        <Layer className="spinner-action-offset isolate">
          <ArcHalf side="bottom" className="spinner-action-near" d="M-9 0A9 9 0 0 1 9 0" />
          <ArcHalf side="top" className="spinner-action-far" d="M9 0A9 9 0 0 1-9 0" />
          <Layer className="mix-blend-plus-lighter">
            <Glyph>
              <path d="M7.75 0A1.25 1.25 0 0 1 10.25 0Z" fill="currentColor" />
            </Glyph>
          </Layer>
          <Layer className="spinner-action-head mix-blend-plus-lighter">
            <Glyph>
              <path d="M10.25 0A1.25 1.25 0 0 1 7.75 0Z" fill="currentColor" />
            </Glyph>
          </Layer>
        </Layer>
      </Layer>
    </>
  );
}

// Each square is drawn in the top-left cell and rotated into its quadrant, so one inward translate
// folds all four toward the center.
const FOLD_QUADRANTS = [
  { turn: 0, opacity: 1 },
  { turn: 90, opacity: 0.7 },
  { turn: 180, opacity: 0.45 },
  { turn: 270, opacity: 0.7 },
];

function foldingGrid(): ReactNode {
  return (
    <Layer className="spinner-loading-turn">
      {FOLD_QUADRANTS.map(({ turn, opacity }) => (
        <Layer key={turn} style={{ transform: `rotate(${turn}deg)` }}>
          <Layer className="spinner-loading-fold">
            <Glyph>
              <rect
                x="-9"
                y="-9"
                width="8"
                height="8"
                rx="1.4"
                fill="currentColor"
                opacity={opacity}
              />
            </Glyph>
          </Layer>
        </Layer>
      ))}
    </Layer>
  );
}

function triangleOrbit(): ReactNode {
  return (
    <Layer className="spinner-subagent-orbit">
      {[1, 0.68, 0.42].map((opacity, index) => (
        <Layer key={opacity} style={{ transform: `rotate(${index * 120}deg)` }}>
          <Layer className="spinner-subagent-tuck">
            <Glyph>
              <circle cy="-7" r="3.4" fill="currentColor" opacity={opacity} />
            </Glyph>
          </Layer>
        </Layer>
      ))}
    </Layer>
  );
}

// Each pill is two caps that slide apart around a bar that stretches between them, so it keeps its
// round ends at every height. The pieces overlap; the voice spinner only sits on opaque colors.
function stretchingPills(): ReactNode {
  return [-10.5, -2.75, 5].map((x, index) => (
    <Layer
      key={x}
      className="spinner-voice-pill"
      style={{ "--spinner-voice-delay": `${index * 0.12 - 1.2}s` } as CSSProperties}
    >
      {["spinner-voice-cap-top", "spinner-voice-cap-bottom"].map((cap) => (
        <Layer key={cap} className={cap}>
          <Glyph>
            <circle cx={x + 2.75} r="2.75" fill="currentColor" />
          </Glyph>
        </Layer>
      ))}
      <Layer className="spinner-voice-bar">
        <Glyph>
          <rect x={x} y="-4.75" width="5.5" height="9.5" fill="currentColor" />
        </Glyph>
      </Layer>
    </Layer>
  ));
}

const GLYPHS: Record<SpinnerVariant, () => ReactNode> = {
  action: growingArc,
  loading: foldingGrid,
  subagent: triangleOrbit,
  voice: stretchingPills,
};

export function Spinner({ className, variant = "loading", ...props }: SpinnerProps) {
  return (
    <span
      aria-label="Loading"
      role="status"
      {...props}
      className={cn("relative inline-block size-4 shrink-0", className)}
    >
      {GLYPHS[variant]()}
    </span>
  );
}
