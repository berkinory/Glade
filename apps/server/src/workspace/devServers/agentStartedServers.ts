// Which listening processes an agent running in this Glade started, and from which background task.

// Agents start servers through a shell under their own CLI, often behind a package script that
// spawns another shell: `glade → claude → zsh → bun run dev → sh → vite`.
export const AGENT_LINEAGE_MAX_DEPTH = 8;

// Claude writes a background command's output to `<session>/tasks/<taskId>.output`, so a process
// whose stdout is that file belongs to that task.
const TASK_OUTPUT_PATH_PATTERN = /[\\/]tasks[\\/]([A-Za-z0-9_-]+)\.output$/;

/** The pid and its ancestors up to, not including, `ownerPid`; null when `ownerPid` is not one. */
export function lineageUnderOwner(
  pid: number,
  parentPidOf: (pid: number) => number | undefined,
  ownerPid: number,
): number[] | null {
  const lineage: number[] = [];
  let current: number | undefined = pid;
  for (let depth = 0; depth < AGENT_LINEAGE_MAX_DEPTH && current !== undefined; depth++) {
    if (current === ownerPid) return lineage;
    if (current <= 1 || lineage.includes(current)) return null;
    lineage.push(current);
    current = parentPidOf(current);
  }
  return current === ownerPid ? lineage : null;
}

/** Task ids by pid from `lsof -a -d 1 -Fn -p ...` output. */
export function parseStdoutTaskIds(output: string): Map<number, string> {
  const taskIdByPid = new Map<number, string>();
  let currentPid: number | null = null;
  for (const rawLine of output.split(/\r?\n/g)) {
    const line = rawLine.trim();
    if (line.startsWith("p")) {
      const pid = Number(line.slice(1));
      currentPid = Number.isInteger(pid) && pid > 0 ? pid : null;
      continue;
    }
    if (!line.startsWith("n") || currentPid === null) continue;
    const taskId = TASK_OUTPUT_PATH_PATTERN.exec(line.slice(1))?.[1];
    if (taskId) taskIdByPid.set(currentPid, taskId);
  }
  return taskIdByPid;
}
