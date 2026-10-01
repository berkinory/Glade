export function middleEffort<T>(levels: readonly T[]): T | undefined {
  return levels[Math.floor((levels.length - 1) / 2)];
}

export function formatEffortLabel(value: string): string {
  return value
    .split(/[-_\s]+/u)
    .filter(Boolean)
    .map((word) => {
      const lower = word.toLowerCase();
      return lower.startsWith("x") && lower.length > 1
        ? `x${lower[1]!.toUpperCase()}${lower.slice(2)}`
        : lower[0]!.toUpperCase() + lower.slice(1);
    })
    .join(" ");
}
