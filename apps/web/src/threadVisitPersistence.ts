import type { ProjectId } from "@glade/contracts/core/baseSchemas";
import type { AppState } from "./storeState";
import { LOCAL_ENVIRONMENT } from "./environments/environmentKey";
import { resolveWsHttpUrl } from "./lib/wsHttpUrl";

const MAX_VISITS = 5000;
let storageKey: string | undefined;
let remembered: Record<string, string> = {};
const scopeListeners = new Set<() => void>();
const visitListeners = new Set<(visits: readonly (readonly [string, string])[]) => void>();

function readVisits(): Record<string, string> {
  if (!storageKey || typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw || raw.length > 1024 * 1024) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed)
        .slice(0, MAX_VISITS)
        .filter(
          ([id, at]) =>
            id.length > 0 &&
            id.length <= 256 &&
            typeof at === "string" &&
            at.length <= 32 &&
            Number.isFinite(Date.parse(at)),
        ),
    );
  } catch {
    return {};
  }
}

// The server supplies profile identity before any restored thread is normalized.
export function initializeVisitScope(profile: string | undefined): boolean {
  const next =
    profile && typeof window !== "undefined"
      ? `glade:visits:v1:${new URL(resolveWsHttpUrl("/", LOCAL_ENVIRONMENT)).origin}:${profile}`
      : undefined;
  if (next === storageKey) return false;
  const changed = storageKey !== undefined;
  storageKey = next;
  remembered = readVisits();
  for (const listener of scopeListeners) listener();
  return changed;
}

export function rememberedThreadVisit(id: string): string | undefined {
  return remembered[id];
}

export function persistThreadVisits(state: AppState): void {
  if (!storageKey || !state.threadsHydrated || typeof window === "undefined") return;
  const current = Object.fromEntries(
    Object.values(state.sidebarThreadSummaryById)
      .filter((thread) => thread.lastVisitedAt !== undefined)
      .map((thread) => [thread.id, thread.lastVisitedAt!]),
  );
  const changes = Object.entries(current).filter(([id, at]) => remembered[id] !== at);
  const removed = Object.keys(remembered).filter(
    (id) => !Object.hasOwn(state.sidebarThreadSummaryById, id),
  );
  if (changes.length === 0 && removed.length === 0) return;
  const merged = readVisits();
  for (const [id, at] of changes) merged[id] = at;
  for (const id of removed) delete merged[id];
  const bounded = Object.fromEntries(
    Object.entries(merged)
      .toSorted((a, b) => b[1].localeCompare(a[1]))
      .slice(0, MAX_VISITS),
  );
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(bounded));
    remembered = current;
  } catch {
    // Keep pending changes in memory when browser storage is unavailable.
  }
}

export function readActivityScope(): ProjectId | "chats" | null {
  if (!storageKey || typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(`${storageKey}:activity`);
    return value && value.length <= 256 ? (value as ProjectId | "chats") : null;
  } catch {
    return null;
  }
}

export function writeActivityScope(value: ProjectId | "chats" | null): void {
  if (!storageKey || typeof window === "undefined") return;
  try {
    if (value === null) window.localStorage.removeItem(`${storageKey}:activity`);
    else window.localStorage.setItem(`${storageKey}:activity`, value);
  } catch {
    /* Preferences remain usable when storage is unavailable. */
  }
}

export function subscribeVisitScope(listener: () => void): () => void {
  scopeListeners.add(listener);
  return () => {
    scopeListeners.delete(listener);
  };
}

export function subscribeThreadVisits(
  listener: (visits: readonly (readonly [string, string])[]) => void,
): () => void {
  visitListeners.add(listener);
  return () => {
    visitListeners.delete(listener);
  };
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (!storageKey || event.key !== storageKey) return;
    const next = readVisits();
    const changes = Object.entries(next).filter(([id, at]) => remembered[id] !== at);
    remembered = next;
    for (const listener of visitListeners) listener(changes);
  });
}
