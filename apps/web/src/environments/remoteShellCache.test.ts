import { MessageId } from "@glade/contracts/core/baseSchemas";
import { OrchestrationShellSnapshot } from "@glade/contracts/orchestration/snapshots";
import { Schema } from "effect";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createAppStore } from "../appStore";
import { appStorage } from "../lib/storage";
import { REMOTE_STORE_SIDE_EFFECTS } from "../storeSideEffects";
import { initialState } from "../storeState";
import { makeReadModelThread } from "../storeTestFixtures";
import { attachRemoteShellCache, type RemoteShellCache } from "./remoteShellCache";

const key = "ssh:cache-test";
const storageKey = `glade:remote-shell:v1:${key}`;
const caches: RemoteShellCache[] = [];
const snapshot = Schema.decodeUnknownSync(OrchestrationShellSnapshot)({
  snapshotSequence: 900,
  spaces: [],
  projects: [
    {
      id: "project-1",
      title: "Remote project",
      workspaceRoot: "/srv/project",
      defaultModelSelection: null,
      createdAt: "2026-02-27T00:00:00.000Z",
      updatedAt: "2026-02-27T00:00:00.000Z",
    },
  ],
  threads: [makeReadModelThread({ title: "Saved chat" })],
  updatedAt: "2026-02-27T00:00:00.000Z",
});

function openStore() {
  const store = createAppStore({
    environmentKey: key,
    initialState,
    effects: REMOTE_STORE_SIDE_EFFECTS,
    onProjectUiStateChanged: () => undefined,
  });
  const cache = attachRemoteShellCache(key, store);
  caches.push(cache);
  return { store, cache };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("document", new EventTarget());
});
afterEach(() => {
  for (const cache of caches.splice(0)) cache.dispose();
  appStorage.removeItem(storageKey);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("restores navigation without hydration or detail, then accepts a lower-sequence empty host", () => {
  const first = openStore();
  first.store.getState().syncServerShellSnapshot(snapshot);
  first.store.getState().syncServerThreadDetail(
    makeReadModelThread({
      messages: [
        {
          id: MessageId.makeUnsafe("message-1"),
          role: "user",
          source: "native",
          text: "PRIVATE MESSAGE BODY",
          turnId: null,
          streaming: false,
          createdAt: snapshot.updatedAt,
          updatedAt: snapshot.updatedAt,
        },
      ],
    }),
  );
  vi.advanceTimersByTime(500);
  expect(appStorage.getItem(storageKey)).not.toContain("PRIVATE MESSAGE BODY");
  first.cache.dispose();

  const second = openStore();
  expect(second.store.getState().projects[0]?.name).toBe("Remote project");
  expect(second.store.getState().threadIds).toEqual(["thread-1"]);
  expect(second.store.getState().threadsHydrated).toBe(false);
  expect(second.store.getState().threadDetailSyncById).toEqual({});
  expect(second.store.getState().messageByThreadId).toEqual({});

  second.store
    .getState()
    .syncServerShellSnapshot({ ...snapshot, snapshotSequence: 1, projects: [], threads: [] });
  expect(second.store.getState().projects).toEqual([]);
  expect(second.store.getState().threadIds).toEqual([]);
  vi.advanceTimersByTime(500);
  second.cache.dispose();
  expect(openStore().store.getState().threadIds).toEqual([]);
});

it("clears pending writes when a host is removed or repaired, and ignores invalid disk data", () => {
  const { store, cache } = openStore();
  store.getState().syncServerShellSnapshot(snapshot);
  cache.clear();
  vi.runAllTimers();
  expect(appStorage.getItem(storageKey)).toBeNull();
  expect(store.getState().threadIds).toEqual([]);
  expect(store.getState().threadsHydrated).toBe(false);

  appStorage.setItem(storageKey, JSON.stringify({ projects: "broken" }));
  const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  expect(openStore().store.getState().projects).toEqual([]);
  expect(appStorage.getItem(storageKey)).toBeNull();
  warning.mockRestore();
});
