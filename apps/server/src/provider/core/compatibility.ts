import { compareSemverVersions } from "./providerMaintenance.ts";
import type { ProviderCli } from "./serverProviderDescriptor.ts";

export function isProviderVersionSupported(cli: ProviderCli, version: string | null): boolean {
  return version !== null && compareSemverVersions(version, cli.minimumVersion) >= 0;
}

export function providerUpgradeMessage(cli: ProviderCli, version: string | null): string {
  return version === null
    ? `Could not determine the installed ${cli.displayName} CLI version. Glade requires ${cli.minimumVersion} or newer.`
    : `${cli.displayName} CLI ${version} is too old for Glade. Update to ${cli.minimumVersion} or newer.`;
}
