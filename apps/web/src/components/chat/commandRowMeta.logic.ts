import { describeCommandOutcome } from "../../lib/commandOutcome";
import { commandReadRange, type ReadRange } from "../../lib/toolCallLabel.commands";
import type { WorkLogEntry } from "../../workLog.types";

function formatReadRange(range: ReadRange): string {
  if ("lastLines" in range) return `last ${range.lastLines} lines`;
  if (range.end === null) return `L${range.start}+`;
  return range.end === range.start ? `L${range.start}` : `L${range.start}–${range.end}`;
}

/**
 * What a command row adds after its label: how many times it ran in a row, the lines a read showed,
 * and how it went once it finished ("451 passed", "12 matches in 4 files", the error it hit).
 */
export function commandRowMetaParts(entry: WorkLogEntry): string[] {
  const command = entry.command ?? entry.rawCommand;
  if (!command) return [];
  const parts: string[] = [];
  if (entry.repeatCount !== undefined && entry.repeatCount > 1) parts.push(`×${entry.repeatCount}`);
  const range = commandReadRange(command);
  if (range) parts.push(formatReadRange(range));
  // A running command and one left in the background have no result yet.
  if (entry.toolStatus !== "running" && !entry.backgroundTask) {
    const outcome = describeCommandOutcome({
      command,
      output: entry.toolDetails?.output,
      failed: entry.toolStatus === "failed",
    });
    if (outcome) parts.push(outcome.text);
  }
  return parts;
}
