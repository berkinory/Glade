import { describe, expect, it } from "vitest";
import {
  resolveGladeDesktopFlavor,
  resolveGladeDesktopRuntimeFlavor,
  gladeDesktopIdentity,
  desktopUpdateChannel,
} from "./desktopIdentity";

describe("Glade desktop identity", () => {
  it("isolates development from production storage and identity", () => {
    const prod = gladeDesktopIdentity("production");
    const dev = gladeDesktopIdentity("development");
    expect(prod.bundleId).toBe("com.agent.glade");
    expect(dev.bundleId).toBe("com.agent.glade.dev");
    expect(prod.defaultHomeDirectoryName).toBe(".glade");
    expect(dev.defaultHomeDirectoryName).toBe(".glade-dev");
    expect(prod.userDataDirectoryName).not.toBe(dev.userDataDirectoryName);
    expect(desktopUpdateChannel("production")).toBe("glade");
    expect(resolveGladeDesktopFlavor({ isDevelopment: true })).toBe("development");
    expect(resolveGladeDesktopFlavor({ isDevelopment: false })).toBe("production");
  });

  it("rejects an invalid packaged identity", () => {
    expect(() =>
      resolveGladeDesktopRuntimeFlavor({
        isPackaged: true,
        isDevelopment: false,
        packagedFlavor: "invalid",
      }),
    ).toThrow("invalid");
  });

  it("does not let inherited source environment change a production package", () => {
    expect(
      resolveGladeDesktopRuntimeFlavor({
        isPackaged: true,
        isDevelopment: false,
        packagedFlavor: "production",
        requestedFlavor: "development",
      }),
    ).toBe("production");
    expect(
      resolveGladeDesktopRuntimeFlavor({
        isPackaged: true,
        isDevelopment: false,
        requestedFlavor: "development",
      }),
    ).toBe("production");
    expect(
      resolveGladeDesktopRuntimeFlavor({
        isPackaged: true,
        isDevelopment: true,
        allowDevelopmentOverride: true,
        requestedFlavor: "development",
      }),
    ).toBe("development");
  });
});
