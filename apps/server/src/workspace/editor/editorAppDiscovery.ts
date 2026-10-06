import { statSync } from "node:fs";
import { join } from "node:path";

import { EDITORS } from "@glade/contracts/settings/editor";

import { execProcessFileAsync } from "../../platform/processRunner";

export type EditorDefinition = (typeof EDITORS)[number];

export interface WindowsStorePackageDefinition {
  readonly packageName: string;
  readonly publisherId: string;
}

interface CachedPowerShellAppxLookup {
  readonly value: Promise<string | null>;
  readonly expiresAt: number;
}

const POWERSHELL_APPX_LOOKUP_TIMEOUT_MS = 1_500;
const POWERSHELL_APPX_LOOKUP_CACHE_TTL_MS = 300_000;
const powershellAppxLookupCache = new Map<string, CachedPowerShellAppxLookup>();

export function getEditorMacApplications(editor: EditorDefinition): readonly string[] | undefined {
  return "macApplications" in editor ? editor.macApplications : undefined;
}

export function getEditorWindowsUriScheme(editor: EditorDefinition): string | undefined {
  return "windowsUriScheme" in editor ? editor.windowsUriScheme : undefined;
}

export function getEditorWindowsStorePackages(
  editor: EditorDefinition,
): readonly WindowsStorePackageDefinition[] | undefined {
  return "windowsStorePackages" in editor ? editor.windowsStorePackages : undefined;
}

function normalizeMacApplicationBundleName(appName: string): string {
  return appName.endsWith(".app") ? appName : `${appName}.app`;
}

function resolveMacApplicationSearchPaths(
  appName: string,
  env: NodeJS.ProcessEnv,
): ReadonlyArray<string> {
  const bundleName = normalizeMacApplicationBundleName(appName);
  const home = env.HOME?.trim();
  const homeCandidates = home
    ? [
        join(home, "Applications", bundleName),
        join(home, "Applications", "JetBrains Toolbox", bundleName),
      ]
    : [];

  return [
    ...homeCandidates,
    join("/Applications", bundleName),
    join("/Applications", "Utilities", bundleName),
    join("/Applications", "JetBrains Toolbox", bundleName),
    join("/System", "Applications", bundleName),
    join("/System", "Applications", "Utilities", bundleName),
  ];
}

export function resolveMacApplicationBundlePath(
  appNames: readonly string[] | undefined,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): string | null {
  if (platform !== "darwin" || !appNames) return null;

  for (const appName of appNames) {
    for (const candidate of resolveMacApplicationSearchPaths(appName, env)) {
      try {
        if (statSync(candidate).isDirectory()) return candidate;
      } catch {}
    }
  }

  return null;
}

export function resolveAvailableMacApplication(
  appNames: readonly string[] | undefined,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): string | null {
  if (platform !== "darwin" || !appNames) return null;

  return (
    appNames.find((appName) =>
      resolveMacApplicationSearchPaths(appName, env).some((candidate) => {
        try {
          return statSync(candidate).isDirectory();
        } catch {
          return false;
        }
      }),
    ) ?? null
  );
}

function windowsStorePackageFamilyName(packageDef: WindowsStorePackageDefinition): string {
  return `${packageDef.packageName}_${packageDef.publisherId}`;
}

function uniqueWindowsStorePackageDefinitions(
  packages: readonly WindowsStorePackageDefinition[],
): readonly WindowsStorePackageDefinition[] {
  const byFamily = new Map<string, WindowsStorePackageDefinition>();
  for (const packageDef of packages) {
    byFamily.set(windowsStorePackageFamilyName(packageDef).toLowerCase(), packageDef);
  }
  return Array.from(byFamily.values());
}

function quotePowerShellLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function resolvePowerShellCacheKey(
  packages: readonly WindowsStorePackageDefinition[],
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): string {
  const families = uniqueWindowsStorePackageDefinitions(packages)
    .map((packageDef) => windowsStorePackageFamilyName(packageDef).toLowerCase())
    .toSorted();
  return JSON.stringify({
    platform,
    families,
    path: env.PATH ?? env.Path ?? env.path ?? "",
    systemRoot: env.SystemRoot ?? env.WINDIR ?? "",
  });
}

async function queryWindowsStorePackageInstallLocation(
  packageDefs: readonly WindowsStorePackageDefinition[],
  env: NodeJS.ProcessEnv,
): Promise<string | null> {
  const packageArray = `@(${packageDefs
    .map(
      (packageDef) =>
        `@{ Name = ${quotePowerShellLiteral(packageDef.packageName)}; Family = ${quotePowerShellLiteral(
          windowsStorePackageFamilyName(packageDef),
        )} }`,
    )
    .join(",")})`;
  const script = [
    `$packages = ${packageArray}`,
    "foreach ($packageDef in $packages) {",
    "  $package = Get-AppxPackage -Name $packageDef.Name -ErrorAction SilentlyContinue | " +
      "Where-Object { $_.PackageFamilyName -ieq $packageDef.Family } | Select-Object -First 1",
    "  if ($null -ne $package -and $package.InstallLocation) {",
    "    Write-Output $package.InstallLocation",
    "    exit 0",
    "  }",
    "}",
    "exit 1",
  ].join("; ");

  try {
    const { stdout } = await execProcessFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      {
        encoding: "utf8",
        env,
        timeout: POWERSHELL_APPX_LOOKUP_TIMEOUT_MS,
        killSignal: "SIGKILL",
      },
    );
    return (
      stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean) ?? null
    );
  } catch {
    return null;
  }
}

// Both hits and misses are cached: a missing Store package would otherwise cost a PowerShell
// launch on every lookup.
export function resolveWindowsStorePackageInstallLocation(
  packages: readonly WindowsStorePackageDefinition[] | undefined,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): Promise<string | null> {
  if (platform !== "win32" || !packages) return Promise.resolve(null);

  const packageDefs = uniqueWindowsStorePackageDefinitions(packages);
  if (packageDefs.length === 0) return Promise.resolve(null);

  const now = Date.now();
  const cacheKey = resolvePowerShellCacheKey(packageDefs, platform, env);
  const cached = powershellAppxLookupCache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.value;

  const value = queryWindowsStorePackageInstallLocation(packageDefs, env);
  powershellAppxLookupCache.set(cacheKey, {
    value,
    expiresAt: now + POWERSHELL_APPX_LOOKUP_CACHE_TTL_MS,
  });
  return value;
}
