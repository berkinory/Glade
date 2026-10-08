import { describe, expect, it, vi } from "vitest";

import {
  hardenElectronUpdater,
  resolveWindowsUpdatePublisherNames,
  verifyWindowsUpdateCodeSignature,
} from "./electronUpdaterSecurity";

const UPDATE_FILE = "C:\\Temp\\GladeSetup.exe";

const signatureOutput = (subject: string) =>
  JSON.stringify({ Status: 0, Path: UPDATE_FILE, SignerCertificate: { Subject: subject } });

describe("electronUpdaterSecurity", () => {
  it("uses only embedded full publisher DNs and never feed-controlled names", () => {
    expect(
      resolveWindowsUpdatePublisherNames(
        ["CN=Feed Controlled, O=Unexpected"],
        [" CN=Glade, O=Acme Tools ", "CN=Only", ""],
      ),
    ).toEqual(["CN=Glade, O=Acme Tools"]);
    expect(resolveWindowsUpdatePublisherNames(["CN=Feed Controlled, O=Unexpected"], null)).toEqual([
      "CN=Feed Controlled, O=Unexpected",
    ]);
  });

  it("validates a matching full distinguished name through the injected execFile seam", async () => {
    const execFile = vi.fn((_file, _args, _options, callback) => {
      callback(
        null,
        JSON.stringify({
          Status: 0,
          Path: "C:\\Users\\test\\AppData\\Local\\Temp\\GladeSetup.exe",
          SignerCertificate: {
            Subject: "CN=Glade, O=Acme Tools",
          },
        }),
        "",
      );
    });

    const result = await verifyWindowsUpdateCodeSignature(
      ["CN=Glade, O=Acme Tools"],
      "C:\\Users\\test\\AppData\\Local\\Temp\\GladeSetup.exe",
      { info: vi.fn(), warn: vi.fn() },
      {
        env: { SystemRoot: "C:\\Windows" },
        execFile,
      },
    );

    expect(result).toBeNull();
    expect(execFile).toHaveBeenCalledWith(
      "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
      expect.arrayContaining([
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        expect.stringContaining(
          "Get-AuthenticodeSignature -LiteralPath 'C:\\Users\\test\\AppData\\Local\\Temp\\GladeSetup.exe'",
        ),
      ]),
      expect.objectContaining({
        encoding: "utf8",
        timeout: 20_000,
        env: expect.objectContaining({ PSModulePath: "" }),
      }),
      expect.any(Function),
    );
  });

  it.each([
    {
      name: "a CN-only publisher allowlist",
      publisherNames: ["CN=Glade"],
      output: signatureOutput("CN=Glade, O=Acme Tools"),
      expected: ["publisherNames: CN=Glade"],
    },
    {
      name: "an unexpected publisher",
      publisherNames: ["CN=Glade, O=Acme Tools"],
      output: signatureOutput("CN=Someone Else, O=Acme Tools"),
      expected: ["publisherNames: CN=Glade, O=Acme Tools", "Someone Else"],
    },
    {
      name: "PowerShell failing to run",
      publisherNames: ["CN=Glade, O=Acme Tools"],
      output: Object.assign(new Error("PowerShell unavailable"), { code: "ENOENT" }),
      expected: ["signature verification could not be completed", "PowerShell unavailable"],
    },
    {
      name: "malformed signature output",
      publisherNames: ["CN=Glade, O=Acme Tools"],
      output: "not-json",
      expected: ["signature verification could not be completed"],
    },
    {
      name: "signature output without the signed file path",
      publisherNames: ["CN=Glade, O=Acme Tools"],
      output: JSON.stringify({
        Status: 0,
        SignerCertificate: { Subject: "CN=Glade, O=Acme Tools" },
      }),
      expected: ["signature verification could not be completed", "no signed file path"],
    },
  ])("fails closed for $name", async ({ publisherNames, output, expected }) => {
    const result = await verifyWindowsUpdateCodeSignature(
      publisherNames,
      UPDATE_FILE,
      { info: vi.fn(), warn: vi.fn() },
      {
        env: { SystemRoot: "C:\\Windows" },
        execFile: vi.fn((_file, _args, _options, callback) =>
          typeof output === "string" ? callback(null, output, "") : callback(output, "", ""),
        ),
      },
    );

    for (const fragment of expected) expect(result).toContain(fragment);
  });

  it("patches electron-updater BaseUpdater spawnSyncLog only on Windows", () => {
    class FakeBaseUpdater {}
    const updaterModule = { BaseUpdater: FakeBaseUpdater };
    const prototype = FakeBaseUpdater.prototype as {
      spawnSyncLog?: (cmd: string, args?: string[]) => string;
      __gladeSpawnSyncLogPatched?: boolean;
    };

    hardenElectronUpdater(updaterModule, {}, "darwin");
    expect("spawnSyncLog" in prototype).toBe(false);

    hardenElectronUpdater(updaterModule, {}, "win32");
    const instance = {
      _logger: { info: vi.fn(), error: vi.fn() },
    };
    const output = prototype.spawnSyncLog?.call(instance, process.execPath, ["--version"]);

    expect(output).toMatch(/^v\d+\.\d+\.\d+/);
    expect(prototype.__gladeSpawnSyncLogPatched).toBe(true);
  });

  it("falls back to feed publisher DNs when no embedded override is supplied", async () => {
    const updater = {
      verifyUpdateCodeSignature: vi.fn(
        async (_publisherNames: string[], _updateFile: string) => "old verifier",
      ),
    };

    hardenElectronUpdater({ BaseUpdater: class {} }, updater, "win32");

    const result = await updater.verifyUpdateCodeSignature(
      ["CN=Feed Publisher, O=Acme Tools"],
      "C:\\Temp\\GladeSetup.exe",
    );
    expect(result).not.toContain("no valid embedded publisher subject DN");
    expect(result).toContain("signature verification could not be completed");
  });

  it("fails closed before invoking the verifier when the packaged publisher pin is absent", async () => {
    const updater = {
      verifyUpdateCodeSignature: vi.fn(
        async (_publisherNames: string[], _updateFile: string) => "old verifier",
      ),
    };

    hardenElectronUpdater({ BaseUpdater: class {} }, updater, "win32", []);

    await expect(
      updater.verifyUpdateCodeSignature(
        ["CN=Feed Controlled, O=Unexpected"],
        "C:\\Temp\\GladeSetup.exe",
      ),
    ).resolves.toContain("no valid embedded publisher subject DN");
  });
});
