import { Children, isValidElement, type ReactNode } from "react";

import { cn } from "~/lib/utils";

function segmentKey(segment: ReactNode): string {
  return isValidElement(segment) ? String(segment.key) : String(segment);
}

export function PullRequestMetaLine({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const segments = Children.toArray(children);
  return (
    <span className={cn("flex min-w-0 items-center gap-1.5", className)}>
      {segments.flatMap((segment, index) =>
        index === 0
          ? segment
          : [
              <span aria-hidden className="shrink-0" key={`separator:${segmentKey(segment)}`}>
                ·
              </span>,
              segment,
            ],
      )}
    </span>
  );
}
