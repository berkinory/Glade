import { isRecord } from "@glade/shared/transport/recordValues";
export type DeepPartial<T> = T extends readonly (infer Item)[]
  ? readonly DeepPartial<Item>[]
  : T extends object
    ? { readonly [Key in keyof T]?: DeepPartial<T[Key]> }
    : T;

const PROTOTYPE_MUTATION_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export function deepMerge<T>(base: T, patch: DeepPartial<T>): T {
  if (!isRecord(base) || !isRecord(patch)) {
    return patch as T;
  }

  const next: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || PROTOTYPE_MUTATION_KEYS.has(key)) {
      continue;
    }
    const current = next[key];
    next[key] = isRecord(current) && isRecord(value) ? deepMerge(current, value) : value;
  }
  return next as T;
}
