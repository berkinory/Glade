import { describe, expect, it } from "vitest";

import { devProcessRoots, selectGladeDevProcessIds, type DevProcess } from "./gladeDevProcesses";

const isGladeDirectory = (path: string) => path.startsWith("/work/Glade/");

describe("Glade development process selection", () => {
  it("selects development trees while preserving production and unrelated processes", () => {
    const processes: DevProcess[] = [
      { pid: 1, parentPid: 0, command: "/Applications/Glade.app/Contents/MacOS/Glade" },
      { pid: 2, parentPid: 1, command: "Glade --max-old-space-size=4096 server/dist/index.mjs" },
      { pid: 10, parentPid: 0, command: "bun run dev", cwd: "/work/Glade/apps/desktop" },
      { pid: 11, parentPid: 10, command: "bun run scripts/dev.mjs" },
      { pid: 12, parentPid: 11, command: "Electron --type=renderer" },
      { pid: 20, parentPid: 0, command: "bun run dev", cwd: "/work/other-app" },
      { pid: 21, parentPid: 20, command: "node vite" },
      { pid: 30, parentPid: 0, command: "bun scripts/dev-stop.ts", cwd: "/work/Glade" },
      {
        pid: 40,
        parentPid: 0,
        command: "Electron --glade-dev-root=/work/archived/Glade/apps/desktop",
      },
      { pid: 41, parentPid: 40, command: "Electron --type=gpu-process" },
      {
        pid: 42,
        parentPid: 0,
        command: "rg --glade-dev-root=/work/archived/Glade/apps/desktop",
        cwd: "/work/Glade",
      },
    ];

    const selected = selectGladeDevProcessIds(processes, isGladeDirectory);
    expect([...selected].toSorted((a, b) => a - b)).toEqual([10, 11, 12, 40, 41]);
    expect(devProcessRoots(processes, selected).map((entry) => entry.pid)).toEqual([10, 40]);
  });

  it("finds a Glade watcher and its launcher even without a visible working directory", () => {
    const processes: DevProcess[] = [
      { pid: 50, parentPid: 0, command: "bun run dev" },
      { pid: 51, parentPid: 50, command: "turbo run dev --filter=@glade/desktop" },
      { pid: 52, parentPid: 51, command: "glade-desktop-dev" },
      { pid: 53, parentPid: 52, command: "bun run dev:electron" },
    ];

    expect(
      [...selectGladeDevProcessIds(processes, isGladeDirectory)].toSorted((a, b) => a - b),
    ).toEqual([50, 51, 52, 53]);
  });
});
