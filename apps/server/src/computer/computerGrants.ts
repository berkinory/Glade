import type { ComputerAccessScope } from "@glade/contracts/computer/computerUse";
import type { RuntimeMode } from "@glade/contracts/provider/sessionPolicy";

// A target is an app as Cua's list_windows names it, optionally narrowed to one window id.
export interface ComputerTarget {
  readonly app: string;
  readonly windowId: number | null;
}

export interface ComputerGrant extends ComputerTarget {
  // The window's title when it was granted, for Settings; null for an app-wide grant.
  readonly windowTitle: string | null;
  readonly scope: ComputerAccessScope;
  readonly grantedAt: string;
  // The thread's permission mode when it granted this without a card; null when the user answered.
  readonly autoGrantedIn: RuntimeMode | null;
}

export interface ComputerGrants {
  // The grant that lets this thread use `scope` on the target, or null. An app-wide grant covers
  // every window of the app; a window grant covers only that window.
  readonly check: (
    threadId: string,
    target: ComputerTarget,
    scope: ComputerAccessScope,
  ) => ComputerGrant | null;
  readonly grant: (threadId: string, grant: ComputerGrant) => void;
  readonly deny: (threadId: string, target: ComputerTarget) => void;
  readonly denied: (threadId: string, target: ComputerTarget) => boolean;
  readonly revoke: (threadId: string, target: ComputerTarget) => boolean;
  readonly list: () => ReadonlyArray<{
    readonly threadId: string;
    readonly grants: ReadonlyArray<ComputerGrant>;
  }>;
  readonly clearThread: (threadId: string) => void;
  // Called after any grant is added or removed.
  readonly onChange: (listener: () => void) => () => void;
}

const RANK: Record<ComputerAccessScope, number> = { read: 0, act: 1, full: 2 };
export const scopeCovers = (granted: ComputerAccessScope, needed: ComputerAccessScope) =>
  RANK[granted] >= RANK[needed];

const sameApp = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();
const sameTarget = (left: ComputerTarget, right: ComputerTarget) =>
  sameApp(left.app, right.app) && left.windowId === right.windowId;
const targetKey = (target: ComputerTarget) =>
  `${target.app.toLowerCase()}\u0000${target.windowId ?? "*"}`;

// Grants live in memory for the server's lifetime of the thread; nothing is persisted, so a
// restart asks again. The owner is the ComputerAccess service.
export function makeComputerGrants(): ComputerGrants {
  const grants = new Map<string, ComputerGrant[]>();
  const denials = new Map<string, Set<string>>();
  const listeners = new Set<() => void>();
  const changed = () => {
    for (const listener of listeners) listener();
  };

  return {
    check: (threadId, target, scope) =>
      (grants.get(threadId) ?? []).find(
        (grant) =>
          sameApp(grant.app, target.app) &&
          (grant.windowId === null || grant.windowId === target.windowId) &&
          scopeCovers(grant.scope, scope),
      ) ?? null,
    grant: (threadId, grant) => {
      const rest = (grants.get(threadId) ?? []).filter((entry) => !sameTarget(entry, grant));
      grants.set(threadId, [...rest, grant]);
      denials.get(threadId)?.delete(targetKey(grant));
      changed();
    },
    deny: (threadId, target) => {
      const set = denials.get(threadId) ?? new Set<string>();
      set.add(targetKey(target));
      denials.set(threadId, set);
    },
    denied: (threadId, target) => denials.get(threadId)?.has(targetKey(target)) ?? false,
    revoke: (threadId, target) => {
      const current = grants.get(threadId) ?? [];
      const rest = current.filter((entry) => !sameTarget(entry, target));
      grants.set(threadId, rest);
      const removed = rest.length !== current.length;
      if (removed) changed();
      return removed;
    },
    list: () =>
      [...grants.entries()]
        .filter(([, entries]) => entries.length > 0)
        .map(([threadId, entries]) => ({ threadId, grants: entries })),
    clearThread: (threadId) => {
      const hadGrants = (grants.get(threadId)?.length ?? 0) > 0;
      grants.delete(threadId);
      denials.delete(threadId);
      if (hadGrants) changed();
    },
    onChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
