import type { ProjectId } from "@glade/contracts/core/baseSchemas";
import type { ThreadEnvironmentMode } from "@glade/contracts/orchestration/threadEntities";
import { create } from "zustand";
import { createMemoryStorage } from "./lib/storage";
import { sanitizeStringKeyedRecord } from "./persistedRecord";
import { readPersistedStoreField, writePersistedStoreField } from "./persistedStoreFields";

const LATEST_PROJECT_KEY = "glade:latest-project:v1";
const PROJECT_ENVIRONMENT_KEY = "glade:project-environment:v1";
const storage = typeof localStorage === "undefined" ? createMemoryStorage() : localStorage;

interface ProjectPreferencesState {
  latestProjectId: ProjectId | null;
  envModeByProjectId: Partial<Record<ProjectId, ThreadEnvironmentMode>>;
  setLatestProjectId: (projectId: ProjectId) => void;
  clearLatestProjectId: (projectId?: ProjectId) => void;
  setProjectEnvMode: (projectId: ProjectId, envMode: ThreadEnvironmentMode) => void;
}

function readLatestProjectId(): ProjectId | null {
  const id = readPersistedStoreField(storage, LATEST_PROJECT_KEY, "latestProjectId");
  return typeof id === "string" ? (id as ProjectId) : null;
}

function readProjectEnvironment(): Partial<Record<ProjectId, ThreadEnvironmentMode>> {
  return sanitizeStringKeyedRecord(
    readPersistedStoreField(storage, PROJECT_ENVIRONMENT_KEY, "envModeByProjectId"),
    (value) => (value === "local" || value === "worktree" ? value : null),
  ) as Partial<Record<ProjectId, ThreadEnvironmentMode>>;
}

export const useProjectPreferencesStore = create<ProjectPreferencesState>((set, get) => ({
  latestProjectId: readLatestProjectId(),
  envModeByProjectId: readProjectEnvironment(),
  setLatestProjectId: (projectId) => {
    set({ latestProjectId: projectId });
    writePersistedStoreField(storage, LATEST_PROJECT_KEY, "latestProjectId", projectId);
  },
  clearLatestProjectId: (projectId) => {
    const current = get().latestProjectId;
    if (current === null || (projectId && current !== projectId)) return;
    set({ latestProjectId: null });
    writePersistedStoreField(storage, LATEST_PROJECT_KEY, "latestProjectId", null);
  },
  setProjectEnvMode: (projectId, envMode) => {
    const current = get().envModeByProjectId;
    if (current[projectId] === envMode) return;
    const next = { ...current, [projectId]: envMode };
    set({ envModeByProjectId: next });
    writePersistedStoreField(storage, PROJECT_ENVIRONMENT_KEY, "envModeByProjectId", next);
  },
}));
