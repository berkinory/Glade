import { cn } from "~/lib/utils";
import { ditherMask } from "./ditherMask";

// A horizontal meter whose dithered fill dissolves toward a solid cap at its value.
export function DitherBar({
  percent,
  color,
  className,
}: {
  readonly percent: number;
  readonly color: string;
  readonly className?: string;
}) {
  return (
    <span className={cn("flex min-w-0 overflow-hidden rounded-full bg-muted/60", className)}>
      <span
        className="flex h-full"
        style={{ width: `max(2px, ${Math.min(100, Math.max(0, percent))}%)` }}
      >
        <span
          className="min-w-0 flex-1"
          style={{ background: color, ...ditherMask(0.75, { fadeTo: "right" }) }}
        />
        <span className="w-0.5 shrink-0" style={{ background: color }} />
      </span>
    </span>
  );
}
