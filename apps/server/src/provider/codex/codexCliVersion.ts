import {
  CLI_VERSION_PATTERN,
  normalizeCliVersion,
  splitPrerelease,
  type ParsedCliVersion,
} from "../core/cliVersion.ts";

import { PROVIDER_COMPATIBILITY, isProviderVersionSupported } from "../core/compatibility.ts";

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
  return isProviderVersionSupported("codex", version);
}

export function formatCodexCliUpgradeMessage(
  version: string | null,
  minimumVersion = PROVIDER_COMPATIBILITY.codex.minimumVersion,
): string {
  const versionLabel = version ? `v${version}` : "the installed version";
  return `Codex CLI ${versionLabel} is too old for Glade. Upgrade to v${minimumVersion} or newer and restart Glade.`;
}
