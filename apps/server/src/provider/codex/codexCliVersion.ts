import {
  CLI_VERSION_PATTERN,
  normalizeCliVersion,
  splitPrerelease,
  type ParsedCliVersion,
} from "../core/cliVersion.ts";

import { PROVIDER_DISPLAY_NAMES } from "@glade/contracts/provider/model";
import { isProviderVersionSupported } from "../core/compatibility.ts";
import type { ProviderCli } from "../core/serverProviderDescriptor.ts";
import { CODEX_PROTOCOL_VERSION } from "./protocol/version.ts";

export const CODEX_CLI: ProviderCli = {
  command: "codex",
  displayName: PROVIDER_DISPLAY_NAMES.codex,
  minimumVersion: CODEX_PROTOCOL_VERSION,
};

function parseSemver(version: string): ParsedCliVersion | null {
  const normalized = normalizeCliVersion(version);
  const { main, prerelease } = splitPrerelease(normalized);
  const segments = main.split(".");
  if (segments.length !== 3) {
    return null;
  }

  const [majorSegment, minorSegment, patchSegment] = segments;
  if (majorSegment === undefined || minorSegment === undefined || patchSegment === undefined) {
    return null;
  }

  const major = Number.parseInt(majorSegment, 10);
  const minor = Number.parseInt(minorSegment, 10);
  const patch = Number.parseInt(patchSegment, 10);
  if (![major, minor, patch].every(Number.isInteger)) {
    return null;
  }

  return {
    major,
    minor,
    patch,
    prerelease:
      prerelease
        ?.split(".")
        .map((segment) => segment.trim())
        .filter((segment) => segment.length > 0) ?? [],
  };
}

export function parseCodexCliVersion(output: string): string | null {
  const match = CLI_VERSION_PATTERN.exec(output);
  if (!match?.[1]) {
    return null;
  }

  const parsed = parseSemver(match[1]);
  if (!parsed) {
    return null;
  }

  return normalizeCliVersion(match[1]);
}

export function isCodexCliVersionSupported(version: string): boolean {
  return isProviderVersionSupported(CODEX_CLI, version);
}

export function formatCodexCliUpgradeMessage(
  version: string | null,
  minimumVersion = CODEX_CLI.minimumVersion,
): string {
  const versionLabel = version ? `v${version}` : "the installed version";
  return `Codex CLI ${versionLabel} is too old for Glade. Upgrade to v${minimumVersion} or newer and restart Glade.`;
}
