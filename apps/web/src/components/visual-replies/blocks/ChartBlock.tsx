import { SERIES_COLORS } from "~/lib/chartSeriesColors";
import { chartDomain, domainFraction, formatChartValue, linePoints } from "./ChartBlock.logic";
import type { ResolvedBlockOf } from "./visualBlockTypes";
import { formatVisualNumber } from "./visualNumber";

type Chart = ResolvedBlockOf<"chart">;

export function ChartBlock({ block }: { readonly block: Chart }) {
  return (
    <figure className="flex min-w-0 flex-col gap-2">
      {block.title ? <figcaption className="font-medium">{block.title}</figcaption> : null}
      {block.series.every((series) => series.values.every(Number.isFinite)) ? (
        <>
          <div aria-hidden="true" className="flex min-w-0 flex-col gap-2">
            {block.series.length > 1 ? <Legend block={block} /> : null}
            {block.kind === "bar" ? <BarChart block={block} /> : <LineChart block={block} />}
          </div>
          <ChartDataTable block={block} />
        </>
      ) : (
        <p className="text-chat-meta text-muted-foreground">
          This chart is not defined for the current inputs.
        </p>
      )}
    </figure>
  );
}

function Legend({ block }: { readonly block: Chart }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-chat-meta text-muted-foreground">
      {block.series.map((series, index) => (
        <span key={`${series.name}:${index}`} className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full" style={{ background: SERIES_COLORS[index] }} />
          {series.name}
        </span>
      ))}
    </div>
  );
}

function BarChart({ block }: { readonly block: Chart }) {
  const domain = chartDomain(
    block.series.flatMap((series) => series.values),
    true,
  );
  const zero = domainFraction(0, domain);
  return (
    <div className="grid grid-cols-[minmax(0,max-content)_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5">
      {block.labels.map((label, labelIndex) => (
        <div key={`${label}:${labelIndex}`} className="contents">
          <span className="max-w-48 truncate text-chat-meta text-muted-foreground">{label}</span>
          <div className="flex min-w-0 flex-col gap-0.5">
            {block.series.map((series, seriesIndex) => {
              const value = series.values[labelIndex]!;
              const end = domainFraction(value, domain);
              return (
                <div key={seriesIndex} className="flex items-center gap-2">
                  <div className="relative h-2.5 min-w-0 flex-1">
                    <div
                      className="absolute inset-y-0 rounded-sm"
                      style={{
                        left: `${Math.min(zero, end) * 100}%`,
                        width: `max(2px, ${Math.abs(end - zero) * 100}%)`,
                        background: SERIES_COLORS[seriesIndex],
                      }}
                    />
                  </div>
                  <span className="w-[7ch] shrink-0 text-end text-chat-meta tabular-nums">
                    {formatChartValue(value, block.unit)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function LineChart({ block }: { readonly block: Chart }) {
  const domain = chartDomain(
    block.series.flatMap((series) => series.values),
    false,
  );
  const middle = Math.floor((block.labels.length - 1) / 2);
  return (
    <div className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-2 text-chat-meta text-muted-foreground tabular-nums">
      <div className="flex h-40 flex-col justify-between text-end">
        <span>{formatChartValue(domain.max, block.unit)}</span>
        <span>{formatChartValue(domain.min, block.unit)}</span>
      </div>
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="h-40 w-full overflow-visible border-b border-l border-border"
      >
        {block.series.map((series, index) => (
          <polyline
            key={`${series.name}:${index}`}
            points={linePoints(series.values, domain)}
            fill="none"
            stroke={SERIES_COLORS[index]}
            strokeWidth={2}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      <div />
      <div className="mt-1 flex justify-between gap-2">
        <span className="truncate">{block.labels[0]}</span>
        {middle > 0 ? <span className="truncate">{block.labels[middle]}</span> : null}
        <span className="truncate">{block.labels.at(-1)}</span>
      </div>
    </div>
  );
}

// Screen readers get the exact values the drawing approximates.
function ChartDataTable({ block }: { readonly block: Chart }) {
  return (
    <table className="sr-only">
      <thead>
        <tr>
          <th scope="col">{block.unit ?? ""}</th>
          {block.series.map((series, index) => (
            <th key={index} scope="col">
              {series.name}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {block.labels.map((label, labelIndex) => (
          <tr key={labelIndex}>
            <th scope="row">{label}</th>
            {block.series.map((series, seriesIndex) => (
              <td key={seriesIndex}>{formatVisualNumber(series.values[labelIndex]!)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
