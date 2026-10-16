const chartNumberFormats = [0, 2, 4].map(
  (digits) => new Intl.NumberFormat(undefined, { maximumFractionDigits: digits }),
);

// Labels round by magnitude because formula series rarely land on round numbers.
export function formatChartValue(value: number, unit: string | undefined): string {
  const magnitude = Math.abs(value);
  const text = chartNumberFormats[magnitude >= 100 ? 0 : magnitude >= 1 ? 1 : 2]!.format(value);
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
