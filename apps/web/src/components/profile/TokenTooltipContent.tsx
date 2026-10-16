import { PROVIDER_DISPLAY_NAMES } from "@glade/contracts/provider/model";
import { ProviderIcon } from "~/components/ProviderIcon";
import { CalendarIcon } from "~/lib/icons";
import { formatCompact } from "./profileFormatting";
import type { ProviderTokens } from "./profileSelectors";

export function TokenTooltipContent({
  title,
  total,
  unit,
  providers,
}: {
  readonly title: string;
  readonly total: number;
  readonly unit: string;
  readonly providers: ReadonlyArray<ProviderTokens>;
}) {
  return (
    <div className="flex min-w-40 flex-col gap-1.5 py-0.5">
      <div className="flex items-center justify-between gap-4">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <CalendarIcon className="size-3.5" />
          {title}
        </span>
        <span className="font-medium tabular-nums">
          {total > 0 ? `${formatCompact(total)} ${unit}` : `No ${unit}`}
        </span>
      </div>
      {providers.length > 0 ? (
        <ul className="flex flex-col gap-1 border-t border-border/60 pt-1.5">
          {providers.map((entry) => (
            <li key={entry.provider} className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-1.5">
                <ProviderIcon provider={entry.provider} className="size-3.5" />
                {PROVIDER_DISPLAY_NAMES[entry.provider]}
              </span>
              <span className="text-muted-foreground tabular-nums">
                {formatCompact(entry.tokens)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
