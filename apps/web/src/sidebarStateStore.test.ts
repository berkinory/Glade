import { ProjectId, ThreadId } from "@glade/contracts/core/baseSchemas";
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

it("hydrates existing sidebar keys and persists each feature under its original shape", async () => {
  const values = new Map<string, string>([
    [
      "glade:pinned-projects:v1",
      JSON.stringify({ state: { pinnedProjectIds: ["project-a"] }, version: 0 }),
    ],
    [
      "glade:pinned-threads:v1",
      JSON.stringify({ state: { pinnedThreadIds: ["thread-a"] }, version: 0 }),
    ],
    [
      "glade:recent-views:v1",
      JSON.stringify({ state: { recentViews: [{ kind: "plugins" }] }, version: 0 }),
    ],
  ]);
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
  vi.stubGlobal("localStorage", storage);
  vi.resetModules();
  const { useSidebarStateStore } = await import("./sidebarStateStore");
  const state = useSidebarStateStore.getState();
  expect(state.pinnedProjectIds).toEqual(["project-a"]);
  expect(state.pinnedThreadIds).toEqual(["thread-a"]);
  expect(state.recentViews).toEqual([{ kind: "plugins" }]);

  state.pinProject(ProjectId.makeUnsafe("project-b"));
  state.pinThread(ThreadId.makeUnsafe("thread-b"));
  state.toggleThread(ThreadId.makeUnsafe("thread-b"));
  expect(JSON.parse(values.get("glade:pinned-projects:v1") ?? "null")).toEqual({
    state: { pinnedProjectIds: ["project-b", "project-a"] },
    version: 0,
  });
  expect(JSON.parse(values.get("glade:pinned-threads:v1") ?? "null")).toEqual({
    state: { pinnedThreadIds: ["thread-b", "thread-a"] },
    version: 0,
  });
  expect(JSON.parse(values.get("glade:recent-views:v1") ?? "null")).toEqual({
    state: { recentViews: [{ kind: "plugins" }] },
    version: 0,
  });
});

it("keeps the legacy sidebar UI document when state changes", async () => {
  const values = new Map([
    [
      "glade:sidebar-ui:v1",
      JSON.stringify({
        chatSectionExpanded: true,
        projectThreadListExtraPagesByCwd: { "/repo": 2 },
        dismissedThreadStatusKeyByThreadId: { "thread-a": "done" },
        lastThreadRoute: { threadId: "thread-a" },
        activityViewEnabled: false,
      }),
    ],
  ]);
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    },
    addEventListener: vi.fn(),
  });
  vi.resetModules();
  const { useSidebarStateStore } = await import("./sidebarStateStore");
  const state = useSidebarStateStore.getState();
  expect(state.chatSectionExpanded).toBe(true);
  expect(state.threadListExtraPagesByProjectCwd.get("/repo")).toBe(2);
  state.setActivityViewEnabled(true);
  expect(JSON.parse(values.get("glade:sidebar-ui:v1") ?? "null")).toEqual({
    chatSectionExpanded: true,
    projectThreadListExtraPagesByCwd: { "/repo": 2 },
    dismissedThreadStatusKeyByThreadId: { "thread-a": "done" },
    lastThreadRoute: { threadId: "thread-a" },
    activityViewEnabled: true,
  });
});
