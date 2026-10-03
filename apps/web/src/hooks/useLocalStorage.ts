import * as Schema from "effect/Schema";
import { useCallback, useEffect, useRef, useState } from "react";
import { appStorage } from "../lib/storage";

const jsonSchemasByCodec = new WeakMap<Schema.Top, Schema.Codec<unknown, string>>();

function getJsonSchema<T, E>(schema: Schema.Codec<T, E>): Schema.Codec<T, string> {
  let jsonSchema = jsonSchemasByCodec.get(schema);
  if (!jsonSchema) {
    jsonSchema = Schema.fromJsonString(schema);
    jsonSchemasByCodec.set(schema, jsonSchema);
  }

  return jsonSchema as Schema.Codec<T, string>;
}

const decodedValues = new WeakMap<Schema.Top, Map<string, { raw: string; value: unknown }>>();

function freezeDecodedValue(value: unknown): void {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return;
  for (const child of Object.values(value)) freezeDecodedValue(child);
  Object.freeze(value);
}

function decode<T, E>(key: string, schema: Schema.Codec<T, E>, raw: string): T {
  let values = decodedValues.get(schema);
  const cached = values?.get(key);
  if (cached?.raw === raw) return cached.value as T;
  const value = Schema.decodeSync(getJsonSchema(schema))(raw);
  freezeDecodedValue(value);
  if (!values) {
    values = new Map();
    decodedValues.set(schema, values);
  }
  // Keep only the latest value per key and bound dynamic-key consumers.
  if (values.size >= 64) values.delete(values.keys().next().value!);
  values.set(key, { raw, value });
  return value;
}

const encode = <T, E>(schema: Schema.Codec<T, E>, value: T) =>
  Schema.encodeSync(getJsonSchema(schema))(value);

export const getLocalStorageItem = <T, E>(key: string, schema: Schema.Codec<T, E>): T | null => {
  const item = appStorage.getItem(key);
  return item ? decode(key, schema, item) : null;
};

export const setLocalStorageItem = <T, E>(key: string, value: T, schema: Schema.Codec<T, E>) => {
  const valueToSet = encode(schema, value);
  appStorage.setItem(key, valueToSet);
};

export const removeLocalStorageItem = (key: string) => {
  appStorage.removeItem(key);
};

const LOCAL_STORAGE_CHANGE_EVENT = "glade:local_storage_change";

interface LocalStorageChangeDetail {
  key: string;
}

function dispatchLocalStorageChange(key: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<LocalStorageChangeDetail>(LOCAL_STORAGE_CHANGE_EVENT, {
      detail: { key },
    }),
  );
}

function readLocalStorageItemOrFallback<T, E>(
  key: string,
  fallback: T,
  schema: Schema.Codec<T, E>,
): T {
  try {
    const item = getLocalStorageItem(key, schema);
    return item ?? fallback;
  } catch (error) {
    console.error("[LOCALSTORAGE] Error:", error);
    return fallback;
  }
}

function persistLocalStorageValue<T, E>(
  key: string,
  previous: T,
  value: T | ((val: T) => T),
  schema: Schema.Codec<T, E>,
): T {
  const valueToStore = typeof value === "function" ? (value as (val: T) => T)(previous) : value;
  try {
    if (valueToStore === null) {
      removeLocalStorageItem(key);
    } else {
      setLocalStorageItem(key, valueToStore, schema);
    }

    queueMicrotask(() => dispatchLocalStorageChange(key));
  } catch (error) {
    console.error("[LOCALSTORAGE] Error:", error);
  }
  return valueToStore;
}

export function useLocalStorage<T, E>(
  key: string,
  initialValue: T,
  schema: Schema.Codec<T, E>,
): [T, (value: T | ((val: T) => T)) => void] {
  const [storedValue, setStoredValue] = useState<T>(() =>
    readLocalStorageItemOrFallback(key, initialValue, schema),
  );

  const setValue = useCallback(
    (value: T | ((val: T) => T)) => {
      setStoredValue((prev) => persistLocalStorageValue(key, prev, value, schema));
    },
    [key, schema],
  );

  const prevKeyRef = useRef(key);

  useEffect(() => {
    if (prevKeyRef.current === key) {
      return;
    }
    prevKeyRef.current = key;
    const timeoutId = window.setTimeout(() => {
      setStoredValue(readLocalStorageItemOrFallback(key, initialValue, schema));
    }, 0);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [key, initialValue, schema]);

  useEffect(() => {
    const syncFromStorage = () => {
      setStoredValue(readLocalStorageItemOrFallback(key, initialValue, schema));
    };

    const handleStorageChange = (event: StorageEvent) => {
      const affectsLocalStorage = event.storageArea === null || event.storageArea === appStorage;

      if (affectsLocalStorage && (event.key === null || event.key === key)) {
        syncFromStorage();
      }
    };

    const handleLocalChange = (event: CustomEvent<LocalStorageChangeDetail>) => {
      if (event.detail.key === key) {
        syncFromStorage();
      }
    };

    window.addEventListener("storage", handleStorageChange);
    window.addEventListener(LOCAL_STORAGE_CHANGE_EVENT, handleLocalChange as EventListener);

    return () => {
      window.removeEventListener("storage", handleStorageChange);
      window.removeEventListener(LOCAL_STORAGE_CHANGE_EVENT, handleLocalChange as EventListener);
    };
  }, [key, initialValue, schema]);

  return [storedValue, setValue];
}
