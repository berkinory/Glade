import { ThreadId } from "@glade/contracts/core/baseSchemas";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const threadId = ThreadId.makeUnsafe("workspace-layout-test");

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  vi.resetModules();
});
afterEach(() => vi.unstubAllGlobals());

it("restores resource ownership and group history, then collapses an emptied group without losing chat", async () => {
  const { useMainWorkspaceStore } = await import("./mainWorkspaceStore");
  const workspace = useMainWorkspaceStore.getState();
  workspace.reconcileTabs(threadId, ["chat", "file:a", "file:b", "terminal:one"], "file:a");
  workspace.selectTab(threadId, "terminal:one");
  workspace.selectTab(threadId, "file:a");
  workspace.splitTab(threadId, "file:a", "horizontal");
  workspace.moveTab(threadId, "file:b", 1);
  workspace.selectTab(threadId, "file:a");
  workspace.resizeSplit(threadId, 0.65);
  vi.resetModules();
  const restored = (await import("./mainWorkspaceStore")).useMainWorkspaceStore;
  expect(restored.getState().states[threadId]?.layout).toMatchObject({
    groups: [
      { tabIds: ["chat", "terminal:one"], activeTabId: "terminal:one" },
      { tabIds: ["file:a", "file:b"], activeTabId: "file:a" },
    ],
    activeGroup: 1,
    ratio: 0.65,
  });
  restored.getState().reconcileTabs(threadId, ["chat", "file:b", "terminal:one"], "file:a");
  expect(restored.getState().states[threadId]?.activeTabId).toBe("file:b");
  restored.getState().reconcileTabs(threadId, ["chat", "terminal:one"], "file:b");
  expect(restored.getState().states[threadId]?.layout.groups).toEqual([
    {
      tabIds: ["chat", "terminal:one"],
      activeTabId: "terminal:one",
      recentIds: ["terminal:one", "chat"],
    },
  ]);
});

it("opening previews in another group preserves the other group's file and review", async () => {
  const { useMainWorkspaceStore } = await import("./mainWorkspaceStore");
  const { useRightDockStore } = await import("./rightDockStore");
  const workspace = useMainWorkspaceStore.getState();
  const dock = useRightDockStore.getState();
  dock.openFile(threadId, "anchor.ts");
  workspace.splitTab(threadId, "file:anchor.ts", "horizontal");
  workspace.focusGroup(threadId, 0);
  dock.openFile(threadId, "left.ts", { preview: true });
  workspace.focusGroup(threadId, 1);
  dock.openFile(threadId, "right.ts", { preview: true });
  expect(useRightDockStore.getState().dockStateByThreadId[threadId]?.filePaths).toEqual([
    "anchor.ts",
    "left.ts",
    "right.ts",
  ]);
  expect(useRightDockStore.getState().dockStateByThreadId[threadId]?.previewFilePaths).toEqual([
    "left.ts",
    "right.ts",
  ]);
  workspace.focusGroup(threadId, 0);
  dock.openFile(threadId, "next-left.ts", { preview: true });
  expect(useRightDockStore.getState().dockStateByThreadId[threadId]?.filePaths).not.toContain(
    "left.ts",
  );
  expect(useRightDockStore.getState().dockStateByThreadId[threadId]?.previewFilePaths).toEqual([
    "right.ts",
    "next-left.ts",
  ]);
  workspace.focusGroup(threadId, 0);
  workspace.openReview(
    threadId,
    { id: "git:left", kind: "gitFile", filePath: "left.ts", scope: "unstaged" },
    true,
  );
  workspace.focusGroup(threadId, 1);
  workspace.openReview(
    threadId,
    { id: "git:right", kind: "gitFile", filePath: "right.ts", scope: "unstaged" },
    true,
  );
  expect(
    useMainWorkspaceStore.getState().states[threadId]?.reviews.map((review) => review.id),
  ).toEqual(["git:left", "git:right"]);
  dock.openFile(threadId, "next.ts", { preview: true });
  expect(
    useMainWorkspaceStore.getState().states[threadId]?.reviews.map((review) => review.id),
  ).toEqual(["git:left"]);
  expect(useRightDockStore.getState().dockStateByThreadId[threadId]?.filePaths).toContain(
    "next-left.ts",
  );
});

it("keeps browser tabs on their single native surface when opened and moved between groups", async () => {
  const { useMainWorkspaceStore } = await import("./mainWorkspaceStore");
  const workspace = useMainWorkspaceStore.getState();
  workspace.reconcileTabs(threadId, ["chat", "browser:first"], "browser:first");
  workspace.splitTab(threadId, "browser:first", "vertical");
  workspace.focusGroup(threadId, 0);
  workspace.reconcileTabs(threadId, ["chat", "browser:first", "browser:second"], "browser:second");
  expect(useMainWorkspaceStore.getState().states[threadId]?.layout.groups[1]?.tabIds).toEqual([
    "browser:first",
    "browser:second",
  ]);
  workspace.moveTab(threadId, "browser:second", 0);
  expect(
    useMainWorkspaceStore.getState().states[threadId]?.layout.groups.map((group) => group.tabIds),
  ).toEqual([["chat", "browser:first", "browser:second"]]);
});
