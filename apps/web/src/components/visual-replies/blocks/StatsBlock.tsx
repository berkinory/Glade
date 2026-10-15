import { ArrowDown02Icon, ArrowUp02Icon, MinusIcon } from "~/lib/icons";
import type { VisualBlockOf } from "./visualBlockTypes";
import { formatVisualNumber } from "./visualNumber";

const TREND = {
  up: { Icon: ArrowUp02Icon, label: "Up" },
  down: { Icon: ArrowDown02Icon, label: "Down" },
  flat: { Icon: MinusIcon, label: "Unchanged" },
} as const;

export function StatsBlock({ block }: { readonly block: VisualBlockOf<"stats"> }) {
  return (
    <dl className="grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-2">
      {block.items.map((item, index) => {
        const trend = item.trend ? TREND[item.trend] : null;
        return (
          <div
            key={`${item.label}:${index}`}
            className="flex min-w-0 flex-col gap-0.5 rounded-lg bg-secondary px-3 py-2.5"
          >
            <dt className="truncate text-chat-meta text-muted-foreground">{item.label}</dt>
            <dd className="flex items-center gap-1.5 text-[1.5em] leading-tight font-semibold tabular-nums">
              <span className="min-w-0 break-words">
                {typeof item.value === "number" ? formatVisualNumber(item.value) : item.value}
              </span>
              {trend ? (
                <trend.Icon
                  className="size-[0.7em] shrink-0 text-muted-foreground"
                  aria-label={trend.label}
                />
              ) : null}
            </dd>
            {item.detail ? (
              <dd className="text-chat-meta text-muted-foreground">{item.detail}</dd>
            ) : null}
          </div>
        );
      })}
    </dl>
  );
}
