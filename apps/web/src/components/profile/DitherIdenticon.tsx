import { cn } from "~/lib/utils";

const GRID = 18;

const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
].map((row) => row.map((value) => (value + 0.5) / 16));

// FNV-1a, so the same seed always draws the same avatar.
function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

// A disc of ordered-dither pixels whose density ramps from solid on one side to sparse on the
// other, with the direction and the bright spot both derived from the seed.
function identiconPixels(seed: string): ReadonlyArray<{ readonly x: number; readonly y: number }> {
  const hash = hashSeed(seed);
  const angle = ((hash & 0xffff) / 0xffff) * Math.PI * 2;
  const focusX = 0.5 + (((hash >>> 16) & 0xff) / 0xff - 0.5) * 0.6;
  const focusY = 0.5 + (((hash >>> 24) & 0xff) / 0xff - 0.5) * 0.6;
  const directionX = Math.cos(angle);
  const directionY = Math.sin(angle);
  const pixels: { x: number; y: number }[] = [];
  for (let y = 0; y < GRID; y += 1) {
    for (let x = 0; x < GRID; x += 1) {
      const u = (x + 0.5) / GRID;
      const v = (y + 0.5) / GRID;
      if ((u - 0.5) ** 2 + (v - 0.5) ** 2 > 0.25) continue;
      const ramp = 0.5 + ((u - 0.5) * directionX + (v - 0.5) * directionY) * 1.1;
      const glow = 1 - Math.hypot(u - focusX, v - focusY) * 1.6;
      const intensity = Math.max(ramp, glow);
      if (intensity > BAYER[y % 4]![x % 4]!) {
        pixels.push({ x, y });
      }
    }
  }
  return pixels;
}

export function DitherIdenticon({
  seed,
  color,
  className,
}: {
  readonly seed: string;
  readonly color: string;
  readonly className?: string;
}) {
  return (
    <svg
      viewBox={`0 0 ${GRID} ${GRID}`}
      shapeRendering="crispEdges"
      aria-hidden="true"
      className={cn("block", className)}
      fill={color}
    >
      {identiconPixels(seed).map(({ x, y }) => (
        <rect key={`${x}:${y}`} x={x} y={y} width={1} height={1} />
      ))}
    </svg>
  );
}
