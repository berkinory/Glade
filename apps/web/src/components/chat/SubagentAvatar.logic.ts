import type { WorkLogEntry } from "~/workLog.types";

interface AvatarThread {
  id: string;
  parentThreadId?: string | null;
  createdAt: string;
}

function nativeId(id: string): string {
  return id.startsWith("subagent:") ? id.slice(id.lastIndexOf(":") + 1) : id;
}

function preferredAvatar(id: string, count: number): number {
  const identity = nativeId(id);
  let hash = 2166136261;
  for (let i = 0; i < identity.length; i++)
    hash = Math.imul(hash ^ identity.charCodeAt(i), 16777619);
  return (hash >>> 0) % count;
}

export function subagentAvatarIndex(
  id: string,
  threads: readonly AvatarThread[],
  count: number,
): number {
  const target =
    threads.find((thread) => thread.id === id) ??
    threads.find((thread) => nativeId(thread.id) === nativeId(id));
  if (!target?.parentThreadId) return preferredAvatar(id, count);
  const siblings = threads
    .filter((thread) => thread.parentThreadId === target.parentThreadId)
    .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const usage = Array<number>(count).fill(0);
  for (const sibling of siblings) {
    const preferred = preferredAvatar(sibling.id, count);
    const leastUsed = Math.min(...usage);
    let chosen = preferred;
    for (let offset = 0; offset < count; offset++) {
      const candidate = (preferred + offset) % count;
      if (usage[candidate] === leastUsed) {
        chosen = candidate;
        break;
      }
    }
    usage[chosen]!++;
    if (sibling.id === target.id) return chosen;
  }
  return preferredAvatar(id, count);
}

/** The thread whose avatar stands for these entries' subagents: the last one they launched. */
export function lastSubagentThreadId(entries: ReadonlyArray<WorkLogEntry>): string | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]!;
    const subagent = entry.subagentRun?.members.at(-1)?.subagent ?? entry.subagents?.at(-1);
    if (subagent) return subagent.resolvedThreadId ?? subagent.threadId;
  }
  return null;
}
