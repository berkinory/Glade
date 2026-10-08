import type { ProjectId, SpaceId, ThreadId } from "@glade/contracts/core/baseSchemas";
import { SPACE_NAME_MAX_LENGTH } from "@glade/contracts/orchestration/threadEntities";
import { create } from "zustand";

import type { Project } from "./types";

import {
  DEFAULT_VOID_SPACE,
  isVoidSpaceIconName,
  spaceKey,
  type VoidSpacePresentation,
} from "~/lib/spaceGrouping";

const STORAGE_KEY = "glade:spaces-ui:v1";
const CHAT_SPACE_STORAGE_KEY = "glade:chat-spaces:v1";
const HOST_PROJECT_SPACE_STORAGE_KEY = "glade:host-project-spaces:v1";
const VOID_SPACE_STORAGE_KEY = "glade:void-space:v1";

function normalizeVoidSpace(value: unknown): VoidSpacePresentation {
  const record =
    typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  const name =
    typeof record.name === "string" ? record.name.trim().slice(0, SPACE_NAME_MAX_LENGTH) : "";
  const icon =
    typeof record.icon === "string" && isVoidSpaceIconName(record.icon)
      ? record.icon
      : DEFAULT_VOID_SPACE.icon;
  return { name: name.length > 0 ? name : DEFAULT_VOID_SPACE.name, icon };
}

function readVoidSpace(): VoidSpacePresentation {
  if (typeof window === "undefined") return DEFAULT_VOID_SPACE;
  try {
    const raw = window.localStorage.getItem(VOID_SPACE_STORAGE_KEY);
    return raw ? normalizeVoidSpace(JSON.parse(raw)) : DEFAULT_VOID_SPACE;
  } catch {
    return DEFAULT_VOID_SPACE;
  }
}

function persistVoidSpace(voidSpace: VoidSpacePresentation): void {
  if (typeof window === "undefined") return;
  try {
    // An untouched Home follows a future product default.
    if (voidSpace.name === DEFAULT_VOID_SPACE.name && voidSpace.icon === DEFAULT_VOID_SPACE.icon) {
      window.localStorage.removeItem(VOID_SPACE_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(VOID_SPACE_STORAGE_KEY, JSON.stringify(voidSpace));
  } catch {
    // A blocked storage API must not make renaming fail in this session.
  }
}

function readSpaceAssignments(storageKey: string): Record<string, SpaceId> {
  if (typeof window === "undefined") return {};
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(storageKey) ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter(
        (entry): entry is [string, SpaceId] => typeof entry[1] === "string",
      ),
    );
  } catch {
    return {};
  }
}

function writeSpaceAssignments(storageKey: string, value: Record<string, SpaceId>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(value));
  } catch {
    // A blocked storage API must not make Space switching unusable.
  }
}

function assignSpace(
  current: Record<string, SpaceId>,
  key: string,
  spaceId: SpaceId | null,
): Record<string, SpaceId> | null {
  if ((current[key] ?? null) === spaceId) return null;
  const next = { ...current };
  if (spaceId === null) delete next[key];
  else next[key] = spaceId;
  return next;
}

const keepActiveSpaces = (
  assignments: Record<string, SpaceId>,
  activeSpaceIds: ReadonlySet<SpaceId>,
): Record<string, SpaceId> =>
  Object.fromEntries(
    Object.entries(assignments).filter(([, spaceId]) => activeSpaceIds.has(spaceId)),
  );

interface PersistedSpacesUiState {
  activeSpaceId: SpaceId | null;
  lastThreadIdBySpace: Record<string, ThreadId>;
  lastDraftThreadIdBySpace: Record<string, ThreadId>;
}

function readPersisted(): PersistedSpacesUiState {
  if (typeof window === "undefined") {
    return {
      activeSpaceId: null,
      lastThreadIdBySpace: {},
      lastDraftThreadIdBySpace: {},
    };
  }
  try {
    const parsed = JSON.parse(
      window.sessionStorage.getItem(STORAGE_KEY) ?? "null",
    ) as Partial<PersistedSpacesUiState> | null;
    return {
      activeSpaceId:
        typeof parsed?.activeSpaceId === "string" ? (parsed.activeSpaceId as SpaceId) : null,
      lastThreadIdBySpace:
        parsed?.lastThreadIdBySpace && typeof parsed.lastThreadIdBySpace === "object"
          ? parsed.lastThreadIdBySpace
          : {},
      lastDraftThreadIdBySpace:
        parsed?.lastDraftThreadIdBySpace && typeof parsed.lastDraftThreadIdBySpace === "object"
          ? parsed.lastDraftThreadIdBySpace
          : {},
    };
  } catch {
    return {
      activeSpaceId: null,
      lastThreadIdBySpace: {},
      lastDraftThreadIdBySpace: {},
    };
  }
}

function persist(
  state: Pick<SpacesUiState, "activeSpaceId" | "lastThreadIdBySpace" | "lastDraftThreadIdBySpace">,
): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        activeSpaceId: state.activeSpaceId,
        lastThreadIdBySpace: state.lastThreadIdBySpace,
        lastDraftThreadIdBySpace: state.lastDraftThreadIdBySpace,
      }),
    );
  } catch {
    // A blocked storage API must not make Space switching unusable.
  }
}

function recordsEqual<T extends string>(
  left: Record<string, T>,
  right: Record<string, T>,
): boolean {
  const leftEntries = Object.entries(left);
  return (
    leftEntries.length === Object.keys(right).length &&
    leftEntries.every(([key, value]) => right[key] === value)
  );
}

interface SpacesUiState extends PersistedSpacesUiState {
  voidSpace: VoidSpacePresentation;
  setVoidSpace: (patch: Partial<VoidSpacePresentation>) => void;
  resetVoidSpace: () => void;
  chatSpaceByThreadId: Record<string, SpaceId>;
  assignChatThread: (threadId: ThreadId, spaceId: SpaceId | null) => void;
  getChatThreadSpaceId: (threadId: ThreadId) => SpaceId | null;
  // Spaces belong to this machine's server, so a project that exists only on an SSH host keeps its
  // space here. A host project that shares a sidebar entry with a local one follows the local one.
  hostProjectSpaceById: Record<string, SpaceId>;
  assignHostProject: (projectId: ProjectId, spaceId: SpaceId | null) => void;
  pendingActiveSpace: { spaceId: SpaceId; minSequence: number } | null;
  setActiveSpaceId: (spaceId: SpaceId | null) => void;
  setOptimisticActiveSpaceId: (spaceId: SpaceId, minSequence: number) => void;
  rememberThread: (spaceId: SpaceId | null, threadId: ThreadId) => void;
  rememberDraftThread: (spaceId: SpaceId | null, threadId: ThreadId) => void;
  getLastThreadId: (spaceId: SpaceId | null) => ThreadId | null;
  getLastDraftThreadId: (spaceId: SpaceId | null) => ThreadId | null;
  reconcile: (input: {
    activeSpaceIds: ReadonlySet<SpaceId>;
    snapshotSequence: number;
    projectSpaceById: ReadonlyMap<ProjectId, SpaceId | null>;
    threadProjectById: ReadonlyMap<ThreadId, ProjectId>;
  }) => void;
}

const persisted = readPersisted();

export const useSpacesUiStore = create<SpacesUiState>((set, get) => ({
  ...persisted,
  voidSpace: readVoidSpace(),
  setVoidSpace: (patch) => {
    const next = normalizeVoidSpace({ ...get().voidSpace, ...patch });
    const current = get().voidSpace;
    if (next.name === current.name && next.icon === current.icon) return;
    set({ voidSpace: next });
    persistVoidSpace(next);
  },
  resetVoidSpace: () => {
    if (
      get().voidSpace.name === DEFAULT_VOID_SPACE.name &&
      get().voidSpace.icon === DEFAULT_VOID_SPACE.icon
    )
      return;
    set({ voidSpace: DEFAULT_VOID_SPACE });
    persistVoidSpace(DEFAULT_VOID_SPACE);
  },
  chatSpaceByThreadId: readSpaceAssignments(CHAT_SPACE_STORAGE_KEY),
  assignChatThread: (threadId, spaceId) => {
    const next = assignSpace(get().chatSpaceByThreadId, threadId, spaceId);
    if (!next) return;
    writeSpaceAssignments(CHAT_SPACE_STORAGE_KEY, next);
    set({ chatSpaceByThreadId: next });
  },
  getChatThreadSpaceId: (threadId) => get().chatSpaceByThreadId[threadId] ?? null,
  hostProjectSpaceById: readSpaceAssignments(HOST_PROJECT_SPACE_STORAGE_KEY),
  assignHostProject: (projectId, spaceId) => {
    const next = assignSpace(get().hostProjectSpaceById, projectId, spaceId);
    if (!next) return;
    writeSpaceAssignments(HOST_PROJECT_SPACE_STORAGE_KEY, next);
    set({ hostProjectSpaceById: next });
  },
  pendingActiveSpace: null,
  setActiveSpaceId: (activeSpaceId) => {
    set({ activeSpaceId, pendingActiveSpace: null });
    persist(get());
  },
  setOptimisticActiveSpaceId: (activeSpaceId, minSequence) => {
    set({ activeSpaceId, pendingActiveSpace: { spaceId: activeSpaceId, minSequence } });
    persist(get());
  },
  rememberThread: (spaceId, threadId) => {
    const key = spaceKey(spaceId);
    if (get().lastThreadIdBySpace[key] === threadId) return;
    set((state) => ({
      lastThreadIdBySpace: { ...state.lastThreadIdBySpace, [key]: threadId },
    }));
    persist(get());
  },
  rememberDraftThread: (spaceId, threadId) => {
    const key = spaceKey(spaceId);
    if (get().lastDraftThreadIdBySpace[key] === threadId) return;
    set((state) => ({
      lastDraftThreadIdBySpace: { ...state.lastDraftThreadIdBySpace, [key]: threadId },
    }));
    persist(get());
  },
  getLastThreadId: (spaceId) => get().lastThreadIdBySpace[spaceKey(spaceId)] ?? null,
  getLastDraftThreadId: (spaceId) => get().lastDraftThreadIdBySpace[spaceKey(spaceId)] ?? null,
  reconcile: ({ activeSpaceIds, snapshotSequence, projectSpaceById, threadProjectById }) => {
    const current = get();
    const chatSpaceByThreadId = keepActiveSpaces(current.chatSpaceByThreadId, activeSpaceIds);
    if (!recordsEqual(chatSpaceByThreadId, current.chatSpaceByThreadId)) {
      writeSpaceAssignments(CHAT_SPACE_STORAGE_KEY, chatSpaceByThreadId);
    }
    const hostProjectSpaceById = keepActiveSpaces(current.hostProjectSpaceById, activeSpaceIds);
    if (!recordsEqual(hostProjectSpaceById, current.hostProjectSpaceById)) {
      writeSpaceAssignments(HOST_PROJECT_SPACE_STORAGE_KEY, hostProjectSpaceById);
    }
    const pendingActiveSpace =
      current.pendingActiveSpace !== null &&
      (activeSpaceIds.has(current.pendingActiveSpace.spaceId) ||
        snapshotSequence >= current.pendingActiveSpace.minSequence)
        ? null
        : current.pendingActiveSpace;
    const activeSpaceId =
      current.activeSpaceId !== null &&
      !activeSpaceIds.has(current.activeSpaceId) &&
      !(
        pendingActiveSpace?.spaceId === current.activeSpaceId &&
        snapshotSequence < pendingActiveSpace.minSequence
      )
        ? null
        : current.activeSpaceId;
    const lastThreadIdBySpace: Record<string, ThreadId> = {};
    for (const [key, threadId] of Object.entries(current.lastThreadIdBySpace)) {
      if (key !== spaceKey(null) && !activeSpaceIds.has(key as SpaceId)) continue;
      const projectId = threadProjectById.get(threadId);
      if (!projectId) continue;
      const assignedSpaceId = projectSpaceById.has(projectId)
        ? (projectSpaceById.get(projectId) ?? null)
        : (chatSpaceByThreadId[threadId] ?? null);
      if (spaceKey(assignedSpaceId) === key) {
        lastThreadIdBySpace[key] = threadId;
      }
    }
    if (
      activeSpaceId === current.activeSpaceId &&
      pendingActiveSpace === current.pendingActiveSpace &&
      recordsEqual(lastThreadIdBySpace, current.lastThreadIdBySpace) &&
      recordsEqual(chatSpaceByThreadId, current.chatSpaceByThreadId) &&
      recordsEqual(hostProjectSpaceById, current.hostProjectSpaceById)
    ) {
      return;
    }
    set({
      activeSpaceId,
      pendingActiveSpace,
      lastThreadIdBySpace,
      chatSpaceByThreadId,
      hostProjectSpaceById,
    });
    persist(get());
  },
}));

export function readActiveSpaceId(): SpaceId | null {
  return useSpacesUiStore.getState().activeSpaceId;
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key !== null && event.key !== VOID_SPACE_STORAGE_KEY) return;
    useSpacesUiStore.setState({ voidSpace: readVoidSpace() });
  });
}

export function useVoidSpace(): VoidSpacePresentation {
  return useSpacesUiStore((state) => state.voidSpace);
}

// Spaces live on this machine's server; a host project's space is kept in this store instead.
export function projectSpaceId(
  project: Pick<Project, "id" | "spaceId" | "environmentKey">,
  hostProjectSpaceById: Readonly<Record<string, SpaceId>>,
): SpaceId | null {
  return project.environmentKey === undefined
    ? (project.spaceId ?? null)
    : (hostProjectSpaceById[project.id] ?? null);
}

export function useProjectSpaceIdOf(): (
  project: Pick<Project, "id" | "spaceId" | "environmentKey">,
) => SpaceId | null {
  const hostProjectSpaceById = useSpacesUiStore((store) => store.hostProjectSpaceById);
  return (project) => projectSpaceId(project, hostProjectSpaceById);
}
