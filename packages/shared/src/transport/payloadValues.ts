export function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return isObjectRecord(value) && !Array.isArray(value);
}

export function asObjectRecord(value: unknown): Record<string, unknown> | null {
  return isObjectRecord(value) ? value : null;
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}
