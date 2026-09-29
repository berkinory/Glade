import type { ThreadId } from "@glade/contracts";

export function canApplyThreadSnapshot(input: {
  readonly threadId: ThreadId;
  readonly leasedThreadIds: ReadonlySet<ThreadId>;
}): boolean {
  return input.leasedThreadIds.has(input.threadId);
}

// The threads whose detail must be freed as their leases drop: everything the retention cache does
// not own and no surviving lease keeps. `keptThreadIds` covers the paths that drop every lease at
// once and immediately re-lease a subset, so a reconnect never blanks the thread on screen.
export function selectOrphanedThreadDetailIds(input: {
  readonly releasedThreadIds: readonly ThreadId[];
  readonly isRetained: (threadId: ThreadId) => boolean;
  readonly keptThreadIds?: ReadonlySet<ThreadId> | undefined;
}): ThreadId[] {
  const orphaned = new Set<ThreadId>();
  for (const threadId of input.releasedThreadIds) {
    if (input.keptThreadIds?.has(threadId) || input.isRetained(threadId)) {
      continue;
    }
    orphaned.add(threadId);
  }
  return [...orphaned];
}
