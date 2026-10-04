import type {
  ProjectPrewarmSearchIndexInput,
  ProjectPrewarmSearchIndexResult,
} from "@glade/contracts/workspace/project";
import {
  buildWorkspaceIndex,
  type WorkspaceGitRunner,
  type WorkspaceIndex,
} from "./workspaceIndex";
import { WorkspaceEntrySearch } from "./workspaceEntrySearch";

export interface CachedWorkspaceIndex extends WorkspaceIndex {
  search: WorkspaceEntrySearch;
}
interface CacheSlot {
  index?: CachedWorkspaceIndex;
  pending?: Promise<CachedWorkspaceIndex>;
  failed?: { cause: unknown; at: number };
}
const TTL_MS = 15_000;
const MAX_STALE_MS = 60_000;
const RETRY_MS = 5_000;
const MAX_KEYS = 4;
const slots = new Map<string, CacheSlot>();

function trim(): void {
  for (const [key, slot] of slots) {
    if (slots.size <= MAX_KEYS) break;
    if (!slot.pending) slots.delete(key);
  }
}

function build(
  cwd: string,
  slot: CacheSlot,
  runGit: WorkspaceGitRunner,
): Promise<CachedWorkspaceIndex> {
  if (slot.pending) return slot.pending;
  const pending = buildWorkspaceIndex(cwd, runGit)
    .then((index) => {
      const result = { ...index, search: new WorkspaceEntrySearch(index.entries) };
      if (slots.get(cwd) === slot) {
        slot.index = result;
        delete slot.failed;
        slots.delete(cwd);
        slots.set(cwd, slot);
      }
      return result;
    })
    .catch((cause: unknown) => {
      slot.failed = { cause, at: Date.now() };
      throw cause;
    })
    .finally(() => {
      delete slot.pending;
      trim();
    });
  slot.pending = pending;
  return pending;
}

export async function getWorkspaceIndex(
  cwd: string,
  runGit: WorkspaceGitRunner,
): Promise<CachedWorkspaceIndex> {
  let slot = slots.get(cwd);
  if (!slot) {
    slot = {};
    slots.set(cwd, slot);
  }
  if (slot.failed && Date.now() - slot.failed.at < RETRY_MS) throw slot.failed.cause;
  const cached = slot.index;
  if (!cached) return build(cwd, slot, runGit);
  slots.delete(cwd);
  slots.set(cwd, slot);
  const age = Date.now() - cached.scannedAt;
  if (age < TTL_MS) return cached;
  const refresh = build(cwd, slot, runGit);
  if (age >= MAX_STALE_MS || slot.failed) return refresh;
  // The next request reports a failed refresh; stale results cannot mask errors indefinitely.
  void refresh.catch(() => undefined);
  return cached;
}

export function clearWorkspaceIndexCache(cwd: string): void {
  // In-flight builds can finish for their callers, but cannot repopulate an invalidated slot.
  slots.delete(cwd);
}
export function prewarmWorkspaceSearchIndex(
  input: ProjectPrewarmSearchIndexInput,
  runGit: WorkspaceGitRunner,
): ProjectPrewarmSearchIndexResult {
  void getWorkspaceIndex(input.cwd, runGit).catch(() => undefined);
  return { started: true };
}
