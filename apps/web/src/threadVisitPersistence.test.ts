import { afterEach, expect, it, vi } from "vitest";
import { ThreadId } from "@glade/contracts/core/baseSchemas";
import { initialState } from "./storeState";
import { makeFakeWindow, makeThread } from "./storeTestFixtures";
import { buildSidebarThreadSummary } from "./storeProjection.records";

afterEach(() => vi.unstubAllGlobals());

it("restores the last server watermark across reload and isolates profiles", async () => {
  const storage = new Map<string, string>();
  const fakeWindow = makeFakeWindow(storage);
  vi.stubGlobal("window", { ...fakeWindow, location: { origin: "http://localhost:3773" } });
  vi.resetModules();
  const visits = await import("./threadVisitPersistence");
  const id = ThreadId.makeUnsafe("read-thread");
  const at = "2026-10-01T10:00:00.000Z";
  const thread = makeThread({ id, lastVisitedAt: at });
  visits.initializeVisitScope("profile-a");
  visits.persistThreadVisits({
    ...initialState,
    threadsHydrated: true,
    threadIds: [id],
    sidebarThreadSummaryById: { [id]: buildSidebarThreadSummary(thread) },
  });
  visits.writeActivityScope("chats");
  visits.initializeVisitScope("profile-b");
  expect(visits.rememberedThreadVisit(id)).toBeUndefined();
  expect(visits.readActivityScope()).toBeNull();
  visits.initializeVisitScope("profile-a");
  expect(visits.rememberedThreadVisit(id)).toBe(at);
  expect(visits.readActivityScope()).toBe("chats");
  visits.persistThreadVisits({ ...initialState, threadsHydrated: true });
  visits.initializeVisitScope("profile-b");
  visits.initializeVisitScope("profile-a");
  expect(visits.rememberedThreadVisit(id)).toBeUndefined();
});
