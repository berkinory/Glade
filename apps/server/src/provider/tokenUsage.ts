// FILE: tokenUsage.ts
// Purpose: Shared numeric helpers for provider context-window and token-usage snapshots.
// Layer: Server provider utility
// Exports: finite/positive token guards and usage percent math.

export function positiveFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}
