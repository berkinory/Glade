import type { ProjectId, SpaceId, ThreadId } from "@glade/contracts/core/baseSchemas";
import { SPACE_NAME_MAX_LENGTH } from "@glade/contracts/orchestration/threadEntities";
import { create } from "zustand";

import {
  DEFAULT_VOID_SPACE,
  isVoidSpaceIconName,
  spaceKey,
  type VoidSpacePresentation,
} from "~/lib/spaceGrouping";

const STORAGE_KEY = "glade:spaces-ui:v1";
const CHAT_SPACE_STORAGE_KEY = "glade:chat-spaces:v1";
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

function readChatSpaceAssignments(): Record<string, SpaceId> {
  if (typeof window === "undefined") return {};
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(CHAT_SPACE_STORAGE_KEY) ?? "{}");
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

interface PersistedSpacesUiState {
  activeSpaceId: SpaceId | null;
  lastThreadIdBySpace: Record<string, ThreadId>;
  lastDraftThreadIdBySpace: Record<string, ThreadId>;
  lastProjectIdBySpace: Record<string, ProjectId>;
}

function readPersisted(): PersistedSpacesUiState {
  if (typeof window === "undefined") {
    return {
      activeSpaceId: null,
      lastThreadIdBySpace: {},
      lastDraftThreadIdBySpace: {},
      lastProjectIdBySpace: {},
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
      lastProjectIdBySpace:
        parsed?.lastProjectIdBySpace && typeof parsed.lastProjectIdBySpace === "object"
          ? parsed.lastProjectIdBySpace
          : {},
    };
  } catch {
    return {
      activeSpaceId: null,
      lastThreadIdBySpace: {},
      lastDraftThreadIdBySpace: {},
      lastProjectIdBySpace: {},
    };
  }
}

function persist(
  state: Pick<
    SpacesUiState,
    "activeSpaceId" | "lastThreadIdBySpace" | "lastDraftThreadIdBySpace" | "lastProjectIdBySpace"
  >,
): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        activeSpaceId: state.activeSpaceId,
        lastThreadIdBySpace: state.lastThreadIdBySpace,
        lastDraftThreadIdBySpace: state.lastDraftThreadIdBySpace,
        lastProjectIdBySpace: state.lastProjectIdBySpace,
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
  pendingActiveSpace: { spaceId: SpaceId; minSequence: number } | null;
  setActiveSpaceId: (spaceId: SpaceId | null) => void;
  setOptimisticActiveSpaceId: (spaceId: SpaceId, minSequence: number) => void;
  rememberThread: (spaceId: SpaceId | null, threadId: ThreadId) => void;
  rememberDraftThread: (spaceId: SpaceId | null, threadId: ThreadId) => void;
  rememberProject: (spaceId: SpaceId | null, projectId: ProjectId) => void;
  getLastThreadId: (spaceId: SpaceId | null) => ThreadId | null;
  getLastDraftThreadId: (spaceId: SpaceId | null) => ThreadId | null;
  getLastProjectId: (spaceId: SpaceId | null) => ProjectId | null;
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
    ) return;
    set({ voidSpace: DEFAULT_VOID_SPACE });
    persistVoidSpace(DEFAULT_VOID_SPACE);
  },
  chatSpaceByThreadId: readChatSpaceAssignments(),
  assignChatThread: (threadId, spaceId) => {
    const previous = get().chatSpaceByThreadId[threadId] ?? null;
    if (previous === spaceId) return;
    const next = { ...get().chatSpaceByThreadId };
    if (spaceId === null) delete next[threadId];
    else next[threadId] = spaceId;
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(CHAT_SPACE_STORAGE_KEY, JSON.stringify(next));
      } catch {}
    }
    set({ chatSpaceByThreadId: next });
  },
  getChatThreadSpaceId: (threadId) => get().chatSpaceByThreadId[threadId] ?? null,
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
    if (get().lastThreadIdBySpace[key] === threadId && !(key in get().lastProjectIdBySpace)) return;
    set((state) => ({
      lastThreadIdBySpace: { ...state.lastThreadIdBySpace, [key]: threadId },
      lastProjectIdBySpace: Object.fromEntries(
        Object.entries(state.lastProjectIdBySpace).filter(([entryKey]) => entryKey !== key),
      ) as Record<string, ProjectId>,
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
  rememberProject: (spaceId, projectId) => {
    const key = spaceKey(spaceId);
    if (get().lastProjectIdBySpace[key] === projectId && !(key in get().lastThreadIdBySpace))
      return;
    set((state) => ({
      lastProjectIdBySpace: { ...state.lastProjectIdBySpace, [key]: projectId },
      lastThreadIdBySpace: Object.fromEntries(
        Object.entries(state.lastThreadIdBySpace).filter(([entryKey]) => entryKey !== key),
      ) as Record<string, ThreadId>,
    }));
    persist(get());
  },
  getLastThreadId: (spaceId) => get().lastThreadIdBySpace[spaceKey(spaceId)] ?? null,
  getLastDraftThreadId: (spaceId) => get().lastDraftThreadIdBySpace[spaceKey(spaceId)] ?? null,
  getLastProjectId: (spaceId) => get().lastProjectIdBySpace[spaceKey(spaceId)] ?? null,
  reconcile: ({ activeSpaceIds, snapshotSequence, projectSpaceById, threadProjectById }) => {
    const current = get();
    const chatSpaceByThreadId = Object.fromEntries(
      Object.entries(current.chatSpaceByThreadId).filter(([, spaceId]) =>
        activeSpaceIds.has(spaceId),
      ),
    ) as Record<string, SpaceId>;
    if (!recordsEqual(chatSpaceByThreadId, current.chatSpaceByThreadId)) {
      try {
        window.localStorage.setItem(CHAT_SPACE_STORAGE_KEY, JSON.stringify(chatSpaceByThreadId));
      } catch {
        // A blocked storage API must not make Space switching unusable.
      }
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
    const lastProjectIdBySpace: Record<string, ProjectId> = {};
    for (const [key, projectId] of Object.entries(current.lastProjectIdBySpace)) {
      const assignedSpaceId = projectSpaceById.get(projectId);
      if (assignedSpaceId !== undefined && spaceKey(assignedSpaceId) === key) {
        lastProjectIdBySpace[key] = projectId;
      }
    }
    if (
      activeSpaceId === current.activeSpaceId &&
      pendingActiveSpace === current.pendingActiveSpace &&
      recordsEqual(lastThreadIdBySpace, current.lastThreadIdBySpace) &&
      recordsEqual(chatSpaceByThreadId, current.chatSpaceByThreadId) &&
      recordsEqual(lastProjectIdBySpace, current.lastProjectIdBySpace)
    ) {
      return;
    }
    set({
      activeSpaceId,
      pendingActiveSpace,
      lastThreadIdBySpace,
      lastProjectIdBySpace,
      chatSpaceByThreadId,
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
