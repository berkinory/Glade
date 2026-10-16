import type { CSSProperties } from "react";

// 4×4 ordered (Bayer) thresholds. A pixel is lit when its threshold falls under the density.
const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
].map((row) => row.map((value) => (value + 0.5) / 16));

// Unlit pixels keep a faint tint of the same color instead of a hole, so the texture varies
// opacity rather than shade and reads the same on light and dark surfaces.
const UNLIT_OPACITY = 0.22;

// Fading fills dissolve toward their far edge but never below this, so the shape stays legible.
const FADE_FLOOR = "rgb(0 0 0 / 0.35)";

// One CSS pixel per dither cell: two device pixels on a Retina display.
const CELL_PX = 1;

const masks = new Map<string, CSSProperties>();

// A mask that dithers an element's background color at `density` (0–1, rounded to sixteenths).
// `fadeTo` dissolves the texture toward that edge, the way a bar thins away from its baseline.
export function ditherMask(
  density: number,
  options?: { readonly fadeTo?: "top" | "right" },
): CSSProperties {
  const level = Math.max(0, Math.min(16, Math.round(density * 16)));
  const fadeTo = options?.fadeTo;
  const key = `${level}:${fadeTo ?? ""}`;
  const cached = masks.get(key);
  if (cached) {
    return cached;
  }
  const rects = BAYER.flatMap((row, y) =>
    row.map((threshold, x) => {
      const opacity = threshold < level / 16 ? 1 : UNLIT_OPACITY;
      return `<rect x='${x}' y='${y}' width='1' height='1' fill-opacity='${opacity}'/>`;
    }),
  ).join("");
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 4 4' shape-rendering='crispEdges'>${rects}</svg>`;
  const pattern = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
  const size = `${CELL_PX * 4}px ${CELL_PX * 4}px`;
  const mask: CSSProperties = fadeTo
    ? {
        maskImage: `${pattern}, linear-gradient(to ${fadeTo}, black, ${FADE_FLOOR})`,
        maskSize: `${size}, 100% 100%`,
        maskRepeat: "repeat, no-repeat",
        maskComposite: "intersect",
      }
    : { maskImage: pattern, maskSize: size, maskRepeat: "repeat" };
  masks.set(key, mask);
  return mask;
}
