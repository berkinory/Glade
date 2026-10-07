import type { ComputerAccessScope } from "@glade/contracts/computer/computerUse";

// A target is an app as Cua's list_windows names it, optionally narrowed to one window id.
export interface ComputerTarget {
  readonly app: string;
  readonly windowId: number | null;
}

interface ComputerGrant extends ComputerTarget {
  readonly scope: ComputerAccessScope;
  readonly grantedAt: string;
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
}

const RANK: Record<ComputerAccessScope, number> = { read: 0, act: 1, full: 2 };

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

  return {
    check: (threadId, target, scope) =>
      (grants.get(threadId) ?? []).find(
        (grant) =>
          sameApp(grant.app, target.app) &&
          (grant.windowId === null || grant.windowId === target.windowId) &&
          RANK[grant.scope] >= RANK[scope],
      ) ?? null,
    grant: (threadId, grant) => {
      const rest = (grants.get(threadId) ?? []).filter((entry) => !sameTarget(entry, grant));
      grants.set(threadId, [...rest, grant]);
      denials.get(threadId)?.delete(targetKey(grant));
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
      return rest.length !== current.length;
    },
    list: () =>
      [...grants.entries()]
        .filter(([, entries]) => entries.length > 0)
        .map(([threadId, entries]) => ({ threadId, grants: entries })),
    clearThread: (threadId) => {
      grants.delete(threadId);
      denials.delete(threadId);
    },
  };
}
