import type { ProjectId } from "@glade/contracts/core/baseSchemas";
import type { ThreadEnvironmentMode } from "@glade/contracts/orchestration/threadEntities";
import { clampThreadNotes } from "@glade/shared/threads/pinnedMessages";
import { create } from "zustand";
import { createMemoryStorage } from "./lib/storage";
import { sanitizeStringKeyedRecord } from "./persistedRecord";
import { readPersistedStoreField, writePersistedStoreField } from "./persistedStoreFields";

const LATEST_PROJECT_KEY = "glade:latest-project:v1";
const PROJECT_ENVIRONMENT_KEY = "glade:project-environment:v1";
const PROJECT_INSTRUCTIONS_KEY = "glade:project-instructions:v1";
const storage = typeof localStorage === "undefined" ? createMemoryStorage() : localStorage;

interface ProjectPreferencesState {
  latestProjectId: ProjectId | null;
  envModeByProjectId: Partial<Record<ProjectId, ThreadEnvironmentMode>>;
  instructionsByProjectId: Record<string, string>;
  setLatestProjectId: (projectId: ProjectId) => void;
  clearLatestProjectId: (projectId?: ProjectId) => void;
  setProjectEnvMode: (projectId: ProjectId, envMode: ThreadEnvironmentMode) => void;
  setInstructions: (projectId: ProjectId, instructions: string) => void;
  clearInstructions: (projectId: ProjectId) => void;
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

function readProjectInstructions(): Record<string, string> {
  return sanitizeStringKeyedRecord(
    readPersistedStoreField(storage, PROJECT_INSTRUCTIONS_KEY, "instructionsByProjectId"),
    (value) => (typeof value === "string" ? value : null),
  );
}

export const useProjectPreferencesStore = create<ProjectPreferencesState>((set, get) => ({
  latestProjectId: readLatestProjectId(),
  envModeByProjectId: readProjectEnvironment(),
  instructionsByProjectId: readProjectInstructions(),
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
  setInstructions: (projectId, instructions) => {
    const next = { ...get().instructionsByProjectId };
    const clamped = clampThreadNotes(instructions);
    if (clamped.trim().length === 0) delete next[projectId];
    else next[projectId] = clamped;
    set({ instructionsByProjectId: next });
    writePersistedStoreField(storage, PROJECT_INSTRUCTIONS_KEY, "instructionsByProjectId", next);
  },
  clearInstructions: (projectId) => {
    const next = { ...get().instructionsByProjectId };
    delete next[projectId];
    set({ instructionsByProjectId: next });
    writePersistedStoreField(storage, PROJECT_INSTRUCTIONS_KEY, "instructionsByProjectId", next);
  },
}));

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function threadNotesContainInstructionBlock(threadNotes: string, instructions: string): boolean {
  const current = threadNotes.replace(/\r\n/g, "\n").trim();
  if (current.length === 0) return false;
  const normalizedInstructions = instructions.replace(/\r\n/g, "\n").trim();
  const exactBlockPattern = new RegExp(
    `(?:^|\\n\\n)${escapeRegExp(normalizedInstructions)}(?:\\n\\n|$)`,
  );
  return exactBlockPattern.test(current);
}

export function mergeProjectInstructionsIntoThreadNotes(input: {
  readonly threadNotes: string;
  readonly projectInstructions: string;
}): string {
  const instructions = input.projectInstructions.trim();
  if (instructions.length === 0) return input.threadNotes;
  const current = input.threadNotes.trim();
  if (current.length === 0) return clampThreadNotes(instructions);
  if (threadNotesContainInstructionBlock(current, instructions)) return input.threadNotes;
  return clampThreadNotes(`${input.threadNotes.trimEnd()}\n\n${instructions}`);
}
