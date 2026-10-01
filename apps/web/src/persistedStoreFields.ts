interface StoreFieldStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

export function readPersistedStoreField(
  storage: StoreFieldStorage | null,
  key: string,
  field: string,
): unknown {
  if (!storage) return undefined;
  try {
    const envelope: unknown = JSON.parse(storage.getItem(key) ?? "null");
    if (!envelope || typeof envelope !== "object" || !("state" in envelope)) return undefined;
    const state: unknown = envelope.state;
    return state && typeof state === "object" && field in state
      ? (state as Record<string, unknown>)[field]
      : undefined;
  } catch {
    return undefined;
  }
}

export function writePersistedStoreField(
  storage: StoreFieldStorage | null,
  key: string,
  field: string,
  value: unknown,
): void {
  storage?.setItem(key, JSON.stringify({ state: { [field]: value }, version: 0 }));
}
