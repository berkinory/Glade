import { describe, expect, it } from "vitest";

import {
  computerPermissionSetupMessage,
  computerGrantsBlockControl,
  computerStaleGrantAdvice,
  listComputerPermissions,
  sortComputerPermissions,
  missingComputerPermissions,
} from "./computerGrants";

describe("computer permission copy", () => {
  it("requires positive ComputerPermission grant evidence for every Computer permission", () => {
    expect(
      missingComputerPermissions({
        screenRecordingPermission: "denied",
        inputMonitoringPermission: "unknown",
      }),
    ).toEqual(["accessibility", "screenRecording", "inputMonitoring"]);
    expect(
      missingComputerPermissions({
        accessibilityPermission: "granted",
        screenRecordingPermission: "granted",
        inputMonitoringPermission: "denied",
      }),
    ).toEqual(["inputMonitoring"]);
    expect(
      missingComputerPermissions({
        accessibilityPermission: "granted",
        screenRecordingPermission: "granted",
        inputMonitoringPermission: "granted",
      }),
    ).toEqual([]);
  });
  it("names grants in one fixed order whatever order they arrive in", () => {
    expect(sortComputerPermissions(["screenRecording", "accessibility"])).toEqual([
      "accessibility",
      "screenRecording",
    ]);
    expect(listComputerPermissions(["screenRecording", "accessibility"])).toBe(
      "Accessibility and Screen Recording",
    );
    expect(listComputerPermissions(["screenRecording"])).toBe("Screen Recording");
    expect(listComputerPermissions([])).toBe("");
    expect(listComputerPermissions(["inputMonitoring", "screenRecording", "accessibility"])).toBe(
      "Accessibility, Screen Recording and Input Monitoring",
    );
  });

  it("explains a stale grant on an ad-hoc build, naming the right tccutil service", () => {
    const advice = computerStaleGrantAdvice(
      ["accessibility", "screenRecording"],
      "adhoc",
      "com.agent.glade.dev",
    );
    expect(advice).toContain("add the current build again");
    expect(advice).not.toContain("Glade has cleared");
    expect(advice).toContain("tccutil reset Accessibility com.agent.glade.dev");

    expect(advice).toContain("tccutil reset ScreenCapture com.agent.glade.dev");
  });

  it("names the responsible app rather than assuming the released one", () => {
    const advice = computerStaleGrantAdvice(["accessibility"], "adhoc", "com.example.glade.canary");
    expect(advice).toContain("tccutil reset Accessibility com.example.glade.canary");
    expect(advice).not.toContain("com.agent.glade");
  });

  it("withholds the tccutil sentence when no responsible bundle id is known", () => {
    for (const bundleId of [undefined, "", "   "]) {
      const advice = computerStaleGrantAdvice(["accessibility"], "adhoc", bundleId);
      expect(advice).toContain("add the current build again");
      expect(advice).not.toContain("tccutil");
      expect(advice).not.toContain("If none appears");
    }
    expect(computerPermissionSetupMessage(["accessibility"], "adhoc")).not.toContain("tccutil");
  });

  it("says nothing about stale grants on a signed build", () => {
    expect(computerStaleGrantAdvice(["accessibility"], "signed", "com.example.app")).toBeNull();
    const message = computerPermissionSetupMessage(["accessibility"], "signed", "com.example.app");
    expect(message).toContain("Accessibility");
    expect(message).toContain("System Settings");
    expect(message).not.toContain("tccutil");
  });

  it("puts the stale-grant explanation into the ad-hoc setup message", () => {
    const message = computerPermissionSetupMessage(["accessibility"], "adhoc", "com.agent.glade");
    expect(message).toContain("System Settings");
    expect(message).toContain("tccutil reset Accessibility com.agent.glade");
  });
});

describe("computerGrantsBlockControl", () => {
  it("separates the grant that stops everything from the one that only blinds", () => {
    expect(computerGrantsBlockControl(["accessibility"])).toBe(true);
    expect(computerGrantsBlockControl(["accessibility", "screenRecording"])).toBe(true);
    expect(computerGrantsBlockControl(["screenRecording"])).toBe(false);
    expect(computerGrantsBlockControl(["inputMonitoring"])).toBe(true);
    expect(computerGrantsBlockControl([])).toBe(false);
  });
});
