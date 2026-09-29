export type DevProcess = {
  pid: number;
  parentPid: number;
  command: string;
  cwd?: string;
};

const DEV_COMMAND =
  /(?:^|[\\/])(?:bun|node|turbo|vite|tsdown)(?:\.exe)?\s+(?:(?:run\s+)?dev(?::(?:desktop|server|web|bundle|electron))?(?=\s|$)|(?:run\s+)?(?:scripts[\\/]dev-runner\.ts|scripts[\\/]dev(?:-electron)?\.mjs)(?=\s|$)|run\s+src[\\/]index\.ts(?=\s|$)|.*[\\/](?:vite|tsdown)(?:\.js)?(?=\s|$))/i;
const TURBO_DEV_COMMAND = /(?:^|[\\/])turbo(?:\.exe)?\s+run\s+dev(?=\s|$)/i;
const WATCH_COMMAND = /(?:^|[\\/])tsdown(?:\.exe)?(?:\s|$).*--watch(?:\s|$)/i;
const DESKTOP_MARKER = /--glade-dev-root=(?:"[^"]+"|'[^']+'|\S+)/;
const ELECTRON_EXECUTABLE = /(?:^|[\\/])electron(?:\.exe)?(?:\s|$)/i;

function isDevCommand(command: string): boolean {
  return (
    DEV_COMMAND.test(command) || TURBO_DEV_COMMAND.test(command) || WATCH_COMMAND.test(command)
  );
}

function isMarkedDevProcess(process: DevProcess, isGladeDirectory: (path: string) => boolean) {
  if (/^glade-(?:dev-runner|desktop-dev)(?:\s|$)/.test(process.command)) return true;
  if (ELECTRON_EXECUTABLE.test(process.command) && DESKTOP_MARKER.test(process.command)) {
    return true;
  }
  return (
    process.cwd !== undefined && isGladeDirectory(process.cwd) && isDevCommand(process.command)
  );
}

export function selectGladeDevProcessIds(
  processes: readonly DevProcess[],
  isGladeDirectory: (path: string) => boolean,
): Set<number> {
  const byPid = new Map(processes.map((process) => [process.pid, process]));
  const selected = new Set<number>();

  for (const process of processes) {
    if (!isMarkedDevProcess(process, isGladeDirectory)) continue;
    selected.add(process.pid);
    let parent = byPid.get(process.parentPid);
    while (parent && isDevCommand(parent.command)) {
      selected.add(parent.pid);
      parent = byPid.get(parent.parentPid);
    }
  }

  // A dev launcher owns its child tree, including Electron renderers and server
  // workers whose command lines do not repeat the source checkout path.
  let changed = true;
  while (changed) {
    changed = false;
    for (const process of processes) {
      if (selected.has(process.pid) || !selected.has(process.parentPid)) continue;
      selected.add(process.pid);
      changed = true;
    }
  }

  return selected;
}

export function devProcessRoots(processes: readonly DevProcess[], selected: ReadonlySet<number>) {
  return processes.filter(
    (process) => selected.has(process.pid) && !selected.has(process.parentPid),
  );
}
