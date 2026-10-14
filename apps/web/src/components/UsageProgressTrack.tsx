import { cn } from "~/lib/utils";

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}

export function UsageProgressTrack({
  label,
  remainingPercent,
  className,
  fillClassName,
}: {
  label: string;
  remainingPercent: number;
  className?: string | undefined;
  fillClassName: string;
}) {
  const clamped = clampPercent(remainingPercent);

  return (
    <div
      className={cn("relative h-2 w-full overflow-hidden rounded-full bg-muted", className)}
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div
        className={cn(
          "h-full rounded-full transition-[width] duration-120 ease-out motion-reduce:transition-none",
          fillClassName,
        )}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
