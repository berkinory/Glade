import * as FS from "node:fs/promises";
import * as Path from "node:path";

import { resolveWindowsSystemRoot } from "@glade/shared/platform/platformEnvironment";
import { Effect } from "effect";

import { runProcess } from "../platform/processRunner.ts";

const PACKAGES_KEY =
  "HKCU\\Software\\Classes\\Local Settings\\Software\\Microsoft\\Windows\\CurrentVersion\\AppModel\\Repository\\Packages";
const APPS_FOLDER = /^shell:appsFolder\\([^_!\\]+)_([^_!\\]+)!([^!\\]+)$/iu;
const LOOKUP_TIMEOUT_MS = 5_000;

const attribute = (tag: string, name: string) =>
  new RegExp(`\\s${name}="([^"]*)"`, "u").exec(tag)?.[1] ?? null;

// The process image a packaged (Store) app runs as, from its package manifest, for the
// shell:appsFolder launch path Cua lists it under. Cua names the app by its package display name
// until it runs, then by this image ("CalculatorApp.exe"), as every window of it is named. Null
// when the launch path is not a packaged app's or Windows does not have its manifest.
export const packagedExecutable = (launchPath: string | null) =>
  Effect.tryPromise(async () => {
    const packaged = launchPath === null ? null : APPS_FOLDER.exec(launchPath);
    if (process.platform !== "win32" || !packaged) return null;
    const [, name = "", publisher = "", appId] = packaged;
    const listed = await runProcess(
      Path.win32.join(resolveWindowsSystemRoot(), "System32", "reg.exe"),
      ["query", PACKAGES_KEY, "/s", "/v", "PackageRootFolder"],
      { timeoutMs: LOOKUP_TIMEOUT_MS },
    );
    // A family's full names are Name_Version_Arch_ResourceId_Publisher; resource packages of the
    // same family have no Application entries.
    const roots = [
      ...listed.stdout.matchAll(/\\([^\\\r\n]+)\r?\n\s+PackageRootFolder\s+REG_SZ\s+([^\r\n]+)/gu),
    ]
      .filter(([, fullName = ""]) => {
        const parts = fullName.toLowerCase().split("_");
        return parts[0] === name.toLowerCase() && parts.at(-1) === publisher.toLowerCase();
      })
      .map(([, , root = ""]) => root.trim());
    for (const root of roots) {
      const manifest = await FS.readFile(Path.win32.join(root, "AppxManifest.xml"), "utf8").catch(
        () => "",
      );
      const tag = [...manifest.matchAll(/<Application\s[^>]*>/gu)]
        .map(([match]) => match)
        .find((entry) => attribute(entry, "Id") === appId);
      const executable = tag ? attribute(tag, "Executable") : null;
      if (executable) return Path.win32.basename(executable);
    }
    return null;
  }).pipe(Effect.catch(() => Effect.succeed(null)));
