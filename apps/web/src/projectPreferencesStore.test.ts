import { ProjectId } from "@glade/contracts/core/baseSchemas";
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

it("hydrates and updates project preferences under their existing storage keys", async () => {
  const values = new Map<string, string>([
    [
      "glade:latest-project:v1",
      JSON.stringify({ state: { latestProjectId: "project-a" }, version: 0 }),
    ],
    [
      "glade:project-environment:v1",
      JSON.stringify({ state: { envModeByProjectId: { "project-a": "worktree" } }, version: 0 }),
    ],
  ]);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  });
  vi.resetModules();
  const { useProjectPreferencesStore } = await import("./projectPreferencesStore");
  const state = useProjectPreferencesStore.getState();
  expect(state.latestProjectId).toBe("project-a");
  expect(state.envModeByProjectId[ProjectId.makeUnsafe("project-a")]).toBe("worktree");

  state.setLatestProjectId(ProjectId.makeUnsafe("project-b"));
  state.setProjectEnvMode(ProjectId.makeUnsafe("project-b"), "local");
  expect(JSON.parse(values.get("glade:latest-project:v1") ?? "null")).toEqual({
    state: { latestProjectId: "project-b" },
    version: 0,
  });
  expect(JSON.parse(values.get("glade:project-environment:v1") ?? "null")).toEqual({
    state: { envModeByProjectId: { "project-a": "worktree", "project-b": "local" } },
    version: 0,
  });
});
