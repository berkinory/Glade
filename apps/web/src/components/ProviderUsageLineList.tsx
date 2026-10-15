import type { ServerProviderUsageLine } from "@glade/contracts/server/server";
import { cn } from "~/lib/utils";

export function ProviderUsageLineList({
  className,
  lines,
}: {
  className?: string | undefined;
  lines: ReadonlyArray<ServerProviderUsageLine>;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      {lines.map((line) => (
        <div key={`${line.label}:${line.value}`} className="space-y-0.5">
          <div className="flex items-center justify-between gap-2 leading-tight">
            <span className="text-ui-sm font-medium text-foreground">{line.label}</span>
            <span className="text-right text-chat-meta text-muted-foreground">{line.value}</span>
          </div>
          {line.subtitle ? (
            <div className="text-chat-meta leading-tight text-muted-foreground/80">
              {line.subtitle}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
