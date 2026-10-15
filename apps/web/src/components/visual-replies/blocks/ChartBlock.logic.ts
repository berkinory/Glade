import { formatVisualNumber } from "./visualNumber";

export const SERIES_COLORS = [
  "var(--info)",
  "var(--warning)",
  "var(--success)",
  "var(--project-pink)",
  "var(--status-merged)",
] as const;

export function formatChartValue(value: number, unit: string | undefined): string {
  const text = formatVisualNumber(value);
  return unit ? `${text} ${unit}` : text;
}

export interface ChartDomain {
  readonly min: number;
  readonly max: number;
}

// Bars grow from zero, so their domain always includes it; lines fit their data.
export function chartDomain(values: readonly number[], includeZero: boolean): ChartDomain {
  const min = Math.min(...values, ...(includeZero ? [0] : []));
  const max = Math.max(...values, ...(includeZero ? [0] : []));
  if (min === max) return { min: min - 1, max: max + 1 };
  return { min, max };
}

export function domainFraction(value: number, domain: ChartDomain): number {
  return (value - domain.min) / (domain.max - domain.min);
}

export function linePoints(values: readonly number[], domain: ChartDomain): string {
  const step = 100 / (values.length - 1);
  return values
    .map((value, index) => `${index * step},${100 - domainFraction(value, domain) * 100}`)
    .join(" ");
}
