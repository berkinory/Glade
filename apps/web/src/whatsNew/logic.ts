export interface WhatsNewFeature {
  readonly category: string;
  readonly description: string;
  readonly commit?: string;
}

export interface WhatsNewEntry {
  readonly version: string;
  readonly date: string;
  readonly features: readonly WhatsNewFeature[];
}

const COMMIT_LINKS = /\s*\((\[[0-9a-f]{7,40}\]\([^)]*\)(?:,\s*)?)+\)\s*$/u;
const FIRST_COMMIT_SHA = /\/commit\/([0-9a-f]{40})\)/u;

// Reads the CHANGELOG.md layout from docs/release.md: `## X.Y.Z - date`, `### Category`, `- entry`.
export function parseChangelog(markdown: string): readonly WhatsNewEntry[] {
  const entries: { version: string; date: string; features: WhatsNewFeature[] }[] = [];
  let category: string | null = null;
  for (const line of markdown.split(/\r?\n/u)) {
    const release = line.match(/^## (\d+\.\d+\.\d+) - (.+)$/u);
    if (release?.[1] && release[2]) {
      entries.push({ version: release[1], date: release[2].trim(), features: [] });
      category = null;
      continue;
    }
    const heading = line.match(/^### (.+)$/u);
    if (heading?.[1]) {
      category = heading[1].trim();
      continue;
    }
    const current = entries.at(-1);
    if (!current || !category || !line.startsWith("- ")) continue;
    const text = line.slice(2);
    const commit = text.match(COMMIT_LINKS)?.[0].match(FIRST_COMMIT_SHA)?.[1];
    current.features.push({
      category,
      description: text.replace(COMMIT_LINKS, "").replaceAll("`", ""),
      ...(commit ? { commit } : {}),
    });
  }
  return entries;
}

function parseVersion(version: string): readonly [number, number, number] {
  const [rawMajor = "0", rawMinor = "0", rawPatch = "0"] = version.split(".");
  const major = Number.parseInt(rawMajor, 10);
  const minor = Number.parseInt(rawMinor, 10);
  const patch = Number.parseInt(rawPatch, 10);
  return [
    Number.isFinite(major) ? major : 0,
    Number.isFinite(minor) ? minor : 0,
    Number.isFinite(patch) ? patch : 0,
  ] as const;
}

function compareVersions(a: string, b: string): number {
  const [majorA, minorA, patchA] = parseVersion(a);
  const [majorB, minorB, patchB] = parseVersion(b);
  if (majorA !== majorB) return majorA - majorB;
  if (minorA !== minorB) return minorA - minorB;
  return patchA - patchB;
}

export function sortEntriesByVersionDesc(
  entries: readonly WhatsNewEntry[],
): readonly WhatsNewEntry[] {
  return entries.toSorted((left, right) => compareVersions(right.version, left.version));
}

export function sortReleasedEntriesByVersionDesc(
  entries: readonly WhatsNewEntry[],
): readonly WhatsNewEntry[] {
  return sortEntriesByVersionDesc(entries.filter((entry) => entry.date !== "Unreleased"));
}

export interface WhatsNewInputs {
  readonly entries: readonly WhatsNewEntry[];

  readonly currentVersion: string;

  readonly lastSeenVersion: string | null;
}

export type WhatsNewState =
  | {
      readonly kind: "show";
      readonly currentEntry: WhatsNewEntry;
      readonly allEntries: readonly WhatsNewEntry[];
      readonly nextLastSeenVersion: string;
    }
  | {
      readonly kind: "silent-bootstrap";
      readonly nextLastSeenVersion: string;
    }
  | { readonly kind: "noop" };

export function resolveWhatsNewState(inputs: WhatsNewInputs): WhatsNewState {
  const { entries, currentVersion, lastSeenVersion } = inputs;

  if (lastSeenVersion === null) {
    return { kind: "silent-bootstrap", nextLastSeenVersion: currentVersion };
  }

  if (compareVersions(currentVersion, lastSeenVersion) <= 0) {
    return { kind: "noop" };
  }

  const currentEntry = entries.find(
    (entry) => compareVersions(entry.version, currentVersion) === 0,
  );
  if (!currentEntry) {
    return { kind: "silent-bootstrap", nextLastSeenVersion: currentVersion };
  }

  return {
    kind: "show",
    currentEntry,
    allEntries: sortReleasedEntriesByVersionDesc(entries),
    nextLastSeenVersion: currentVersion,
  };
}
