import { describe, expect, it } from "vitest";
import { BackendStartupBlockDetector } from "./backendStartupBlock";

describe("BackendStartupBlockDetector", () => {
  it("recognizes a live database owner across output chunks", () => {
    const detector = new BackendStartupBlockDetector();
    detector.push("[13:46:08.637] ERROR: DatabaseLifecycle");
    detector.push("LockedError: Database lifecycle is locked: owner pid 21610 is live\n");
    expect(detector.read()).toEqual({ kind: "database-locked", ownerPid: 21610 });
  });

  it("classifies a database lock when owner metadata is unavailable", () => {
    const detector = new BackendStartupBlockDetector();
    detector.push("DatabaseLifecycleLockedError: refusing concurrent database access\n");
    expect(detector.read()).toEqual({ kind: "database-locked", ownerPid: null });
  });

  it("leaves other startup errors to generic backend supervision", () => {
    const detector = new BackendStartupBlockDetector();
    detector.push("MigrationSchemaTooNewError: database is newer than this build\n");
    expect(detector.read()).toBeNull();
  });
});
