const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 });

export function formatVisualNumber(value: number, decimals?: number): string {
  if (decimals === undefined) return numberFormat.format(value);
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}
