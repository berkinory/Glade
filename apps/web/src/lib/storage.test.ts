import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createDeferredPersistStorage,
  flushStorageBeforePageHide,
  type FlushBeforePageHideEnv,
} from "./storage";

function createMockStorage() {
  const store = new Map<string, string>();
  return {
    getItem: vi.fn((name: string) => store.get(name) ?? null),
    setItem: vi.fn((name: string, value: string) => {
      store.set(name, value);
    }),
    removeItem: vi.fn((name: string) => {
      store.delete(name);
    }),
  };
}

describe("createDeferredPersistStorage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("defers partialize + JSON.stringify off the set() path until flush", () => {
    const base = createMockStorage();
    type FullState = { readonly value: number; readonly secret: string };
    const fullState = (value: number): FullState => ({ value, secret: "drop" });
    const partialize = vi.fn((state: FullState) => ({ value: state.value }));
    const storage = createDeferredPersistStorage<FullState, { readonly value: number }>({
      getStorage: () => base,
      partialize,
    });

    // Rapid set()s must not serialize: neither partialize nor the base write runs.
    storage.setItem("key", { state: fullState(1), version: 2 });
    storage.setItem("key", { state: fullState(2), version: 2 });
    storage.setItem("key", { state: fullState(3), version: 2 });
    expect(partialize).not.toHaveBeenCalled();
    expect(base.setItem).not.toHaveBeenCalled();

    storage.flush();

    expect(partialize).toHaveBeenCalledExactlyOnceWith({ value: 3, secret: "drop" });
    expect(base.setItem).toHaveBeenCalledExactlyOnceWith(
      "key",
      JSON.stringify({ state: { value: 3 }, version: 2 }),
    );
  });

  it("also writes the pending value when the debounce fires on its own", () => {
    const base = createMockStorage();
    const partialize = vi.fn((state: { readonly value: number }) => state);
    const storage = createDeferredPersistStorage<{ readonly value: number }>({
      getStorage: () => base,
      partialize,
    });

    storage.setItem("key", { state: { value: 1 }, version: 1 });
    expect(base.setItem).not.toHaveBeenCalled();

    vi.advanceTimersByTime(300);
    expect(partialize).toHaveBeenCalledTimes(1);
    expect(base.setItem).toHaveBeenCalledTimes(1);
  });

  it("removeItem cancels a pending write and drops the captured state", () => {
    const base = createMockStorage();
    const partialize = vi.fn((state: { readonly value: number }) => state);
    const storage = createDeferredPersistStorage<{ readonly value: number }>({
      getStorage: () => base,
      partialize,
    });

    storage.setItem("key", { state: { value: 1 }, version: 1 });
    storage.removeItem("key");
    storage.flush();

    expect(partialize).not.toHaveBeenCalled();
    expect(base.setItem).not.toHaveBeenCalled();
    expect(base.removeItem).toHaveBeenCalledWith("key");
  });
});

describe("flushStorageBeforePageHide", () => {
  function makeFakeEnv() {
    const windowListeners = new Map<string, () => void>();
    const documentListeners = new Map<string, () => void>();
    const visibility = { value: "visible" };
    return {
      env: {
        window: {
          addEventListener: (type: string, listener: () => void) => {
            windowListeners.set(type, listener);
          },
        },
        document: {
          addEventListener: (type: string, listener: () => void) => {
            documentListeners.set(type, listener);
          },
          get visibilityState() {
            return visibility.value;
          },
        },
      },
      fireWindow: (type: string) => windowListeners.get(type)?.(),
      fireDocument: (type: string) => documentListeners.get(type)?.(),
      setVisibility: (value: string) => {
        visibility.value = value;
      },
    };
  }

  it("flushes on pagehide, beforeunload, and visibilitychange->hidden only", () => {
    const flush = vi.fn();
    const harness = makeFakeEnv();
    flushStorageBeforePageHide(flush, harness.env);

    harness.fireDocument("visibilitychange");
    expect(flush).not.toHaveBeenCalled();

    harness.fireWindow("pagehide");
    expect(flush).toHaveBeenCalledTimes(1);

    harness.fireWindow("beforeunload");
    expect(flush).toHaveBeenCalledTimes(2);

    harness.setVisibility("hidden");
    harness.fireDocument("visibilitychange");
    expect(flush).toHaveBeenCalledTimes(3);
  });

  it("no-ops on partial DOM stubs without listener APIs", () => {
    // SSR-style test environments stub `window`/`document` with only the fields under test (e.g. `{
    // documentElement }`); wiring must not crash module evaluation of stores that call this at import
    // time.
    expect(() =>
      flushStorageBeforePageHide(vi.fn(), {
        window: {} as unknown as NonNullable<FlushBeforePageHideEnv["window"]>,
        document: { documentElement: {} } as unknown as NonNullable<
          FlushBeforePageHideEnv["document"]
        >,
      }),
    ).not.toThrow();
  });
});
