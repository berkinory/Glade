import type { WorkLogEntry } from "./workLog.types";

/**
 * Folds back-to-back runs of the same command in one turn, such as re-running a failing test, into
 * one entry that shows the latest run and how many there were. A run still in progress, or one left
 * in the background, is never folded into another.
 */
export function foldRepeatedCommands(entries: ReadonlyArray<WorkLogEntry>): WorkLogEntry[] {
  const folded: WorkLogEntry[] = [];
  for (const entry of entries) {
    const previous = folded.at(-1);
    const command = entry.command ?? entry.rawCommand;
    if (
      previous &&
      command &&
      (previous.command ?? previous.rawCommand) === command &&
      previous.turnId === entry.turnId &&
      previous.itemType === entry.itemType &&
      previous.toolStatus !== "running" &&
      entry.toolStatus !== "running" &&
      !previous.backgroundTask &&
      !entry.backgroundTask
    ) {
      // The first run's identity keeps the row in place; the latest run supplies what it shows.
      folded[folded.length - 1] = {
        ...entry,
        id: previous.id,
        createdAt: previous.createdAt,
        ...(previous.sequence !== undefined ? { sequence: previous.sequence } : {}),
        repeatCount: (previous.repeatCount ?? 1) + 1,
      };
      continue;
    }
    folded.push(entry);
  }
  return folded;
}
