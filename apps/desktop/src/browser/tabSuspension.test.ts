import { describe, expect, it } from "vitest";
import { tabsToSuspend, type LiveTabUse } from "./tabSuspension";

const MINUTE = 60_000;
const NOW = 100 * MINUTE;

const tab = (id: string, idleMinutes: number, options: Partial<LiveTabUse> = {}): LiveTabUse => ({
  id,
  lastUsed: NOW - idleMinutes * MINUTE,
  onScreen: false,
  suspendable: true,
  ...options,
});

describe("tab suspension", () => {
  it.each<[string, LiveTabUse[], string | undefined, string[]]>([
    [
      "off-screen tabs go after 5 minutes, on-screen ones after 10",
      [
        tab("off", 6),
        tab("on", 6, { onScreen: true }),
        tab("on-stale", 11, { onScreen: true }),
        tab("fresh", 2),
      ],
      undefined,
      ["off", "on-stale"],
    ],
    [
      "a tab in use is never suspended, however idle",
      [tab("busy", 60, { suspendable: false })],
      undefined,
      [],
    ],
    [
      "beyond four live tabs the least recently used go, skipping kept and busy ones",
      [
        tab("t1", 1.5, { suspendable: false }),
        tab("t2", 1.4),
        tab("t3", 1.3),
        tab("t4", 1.2),
        tab("t5", 1.1),
        tab("t6", 0, { onScreen: true }),
        tab("t7", 2),
      ],
      "t7",
      ["t2", "t3", "t4"],
    ],
    [
      "idle suspensions count toward the cap",
      [tab("t1", 6), tab("t2", 1), tab("t3", 1), tab("t4", 1), tab("t5", 0)],
      undefined,
      ["t1"],
    ],
  ])("%s", (_name, tabs, keep, expected) => {
    expect([...tabsToSuspend(tabs, NOW, keep)].toSorted()).toEqual(expected);
  });
});
