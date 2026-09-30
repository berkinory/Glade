import { isRecord } from "@glade/shared/transport/payloadValues";
import type { ProjectId } from "@glade/contracts/core/baseSchemas";
import type { ThreadEnvironmentMode } from "@glade/contracts/orchestration/threadEntities";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { createMemoryStorage } from "./lib/storage";
import { sanitizeStringKeyedRecord } from "./persistedRecord";

interface ProjectEnvironmentStoreState {
  envModeByProjectId: Partial<Record<ProjectId, ThreadEnvironmentMode>>;
  setProjectEnvMode: (projectId: ProjectId, envMode: ThreadEnvironmentMode) => void;
}

const storage = typeof localStorage !== "undefined" ? localStorage : createMemoryStorage();

export const useProjectEnvironmentStore = create<ProjectEnvironmentStoreState>()(
  persist(
    (set) => ({
      envModeByProjectId: {},
      setProjectEnvMode: (projectId, envMode) =>
        set((state) =>
          state.envModeByProjectId[projectId] === envMode
            ? state
            : { envModeByProjectId: { ...state.envModeByProjectId, [projectId]: envMode } },
        ),
    }),
    {
      name: "glade:project-environment:v1",
      storage: createJSONStorage(() => storage),
      partialize: (state) => ({ envModeByProjectId: state.envModeByProjectId }),
      merge: (persisted, current) => ({
        ...current,
        envModeByProjectId: sanitizeStringKeyedRecord(
          isRecord(persisted) ? persisted.envModeByProjectId : undefined,
          (value) => (value === "local" || value === "worktree" ? value : null),
        ),
      }),
    },
  ),
);
