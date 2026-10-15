const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 });

export function formatVisualNumber(value: number): string {
  return numberFormat.format(value);
}
