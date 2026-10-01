import type { ProviderKind } from "@glade/contracts/core/baseSchemas";
import { CODEX_PROTOCOL_VERSION } from "../codex/protocol/version.ts";
import { compareSemverVersions } from "./providerMaintenance.ts";

export const PROVIDER_COMPATIBILITY = {
  codex: { minimumVersion: CODEX_PROTOCOL_VERSION },
  // Snapshot reads require this CLI version; the SDK build manifest alone does not cover them.
  claudeAgent: { minimumVersion: "2.1.267" },
} as const;

export function isProviderVersionSupported(
  provider: ProviderKind,
  version: string | null,
): boolean {
  return (
    version !== null &&
    compareSemverVersions(version, PROVIDER_COMPATIBILITY[provider].minimumVersion) >= 0
  );
}

export function providerUpgradeMessage(provider: ProviderKind, version: string | null): string {
  const name = provider === "codex" ? "Codex" : "Claude";
  return version === null
    ? `Could not determine the installed ${name} CLI version. Glade requires ${PROVIDER_COMPATIBILITY[provider].minimumVersion} or newer.`
    : `${name} CLI ${version} is too old for Glade. Update to ${PROVIDER_COMPATIBILITY[provider].minimumVersion} or newer.`;
}
