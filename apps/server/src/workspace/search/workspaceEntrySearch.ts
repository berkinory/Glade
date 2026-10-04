import Fuse from "fuse.js";
import type { ProjectEntry, ProjectSearchEntriesResult } from "@glade/contracts/workspace/project";

interface SearchEntry {
  entry: ProjectEntry;
  name: string;
  path: string;
  depth: number;
}
interface RankedEntry {
  value: SearchEntry;
  score: number;
}

function normalize(value: string): string {
  // Search folds all four Turkish I forms; filesystem paths always retain their original spelling.
  return value
    .normalize("NFC")
    .replace(/[İı]/g, "i")
    .toLowerCase();
}
function compare(left: RankedEntry, right: RankedEntry): number {
  return (
    left.score - right.score ||
    left.value.depth - right.value.depth ||
    left.value.entry.path.localeCompare(right.value.entry.path)
  );
}
function insert(results: RankedEntry[], candidate: RankedEntry, limit: number): void {
  if (results.length === limit && compare(candidate, results[limit - 1]!) >= 0) return;
  let low = 0;
  let high = results.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (compare(candidate, results[middle]!) < 0) high = middle;
    else low = middle + 1;
  }
  results.splice(low, 0, candidate);
  if (results.length > limit) results.pop();
}
function literalScore(value: SearchEntry, query: string): number | null {
  if (!query) return value.entry.kind === "directory" ? 0 : 1;
  if (value.name === query) return 0;
  if (value.path === query) return 1;
  if (value.name.startsWith(query)) return 2;
  if (value.name.includes(query)) return 3;
  if (value.path.includes(query)) return 20;
  return null;
}

function hasRequiredCharacters(
  target: string,
  counts: readonly [string, number][],
  errors: number,
): boolean {
  let missing = 0;
  for (const [char, needed] of counts) {
    let found = 0;
    let offset = -1;
    while (found < needed && (offset = target.indexOf(char, offset + 1)) !== -1) found++;
    missing += needed - found;
    if (missing > errors) return false;
  }
  return true;
}

export class WorkspaceEntrySearch {
  private readonly entries: SearchEntry[];
  private readonly recent = new Map<string, ProjectSearchEntriesResult>();

  constructor(
    entries: readonly ProjectEntry[],
    private readonly includePaths = true,
  ) {
    this.entries = entries.map((entry) => {
      const normalizedPath = normalize(entry.path);
      const lastSlash = normalizedPath.lastIndexOf("/");
      return {
        entry,
        path: normalizedPath,
        name: normalizedPath.slice(lastSlash + 1),
        depth: normalizedPath.split("/").length,
      };
    });
  }

  search(
    input: string,
    requestedLimit: number,
    kind?: ProjectEntry["kind"],
  ): ProjectSearchEntriesResult {
    const trimmed = input.trim();
    const query = normalize(
      (this.includePaths ? trimmed.replace(/^[@./]+/, "") : trimmed.replace(/^@+/, "")).replaceAll(
        "\\",
        "/",
      ),
    );
    const limit = Math.max(0, Math.floor(requestedLimit));
    const cacheKey = `${kind ?? "all"}\0${limit}\0${query}`;
    const cached = this.recent.get(cacheKey);
    if (cached) return cached;
    const ranked: RankedEntry[] = [];
    const pathQuery = this.includePaths && query.includes("/");
    let matched = 0;
    let nameMatches = 0;
    for (const value of this.entries) {
      if (kind && value.entry.kind !== kind) continue;
      let score = literalScore(value, query);
      if (!this.includePaths && score === 20) score = null;
      if (score !== null) {
        matched++;
        if (score < 20) nameMatches++;
        insert(ranked, { value, score }, limit + 1);
      }
    }
    // Literal name/path matches are sufficient; typo recovery runs only when those do not exist.
    if ((pathQuery ? matched : nameMatches) === 0 && query.length >= 4) {
      const fuzzyCandidates = new Map<string, SearchEntry[]>();
      // At most two edits, disabled for short queries. Among e+1 disjoint fragments, at least one
      // survives e insertions/deletions/substitutions. Fuse still decides whether a candidate matches.
      const errors = Math.min(2, Math.floor(query.length / 4));
      const fragments = Array.from({ length: errors + 1 }, (_, i) =>
        query.slice(
          Math.floor((i * query.length) / (errors + 1)),
          Math.floor(((i + 1) * query.length) / (errors + 1)),
        ),
      );
      const grams = new Map<string, number>();
      for (let i = 0; i < query.length - 1; i++) {
        const gram = query.slice(i, i + 2);
        grams.set(gram, (grams.get(gram) ?? 0) + 1);
      }
      const requiredGrams = [...grams].toSorted((a, b) => b[1] - a[1]);
      const counts = new Map<string, number>();
      for (const char of query) counts.set(char, (counts.get(char) ?? 0) + 1);
      const requiredCharacters = [...counts].toSorted((a, b) => b[1] - a[1]);
      for (const value of this.entries) {
        if (kind && value.entry.kind !== kind) continue;
        const target = pathQuery ? value.path : value.name;
        if (
          fragments.some((fragment) => target.includes(fragment)) &&
          hasRequiredCharacters(target, requiredCharacters, errors) &&
          hasRequiredCharacters(target, requiredGrams, errors * 2)
        ) {
          const group = fuzzyCandidates.get(target);
          if (group) group.push(value);
          else fuzzyCandidates.set(target, [value]);
        }
      }
      if (fuzzyCandidates.size > 0) {
        const fuse = new Fuse([...fuzzyCandidates.keys()], {
          isCaseSensitive: true,
          ignoreLocation: true,
          ignoreFieldNorm: true,
          includeScore: true,
          threshold: errors / query.length,
        });
        const hits = fuse.search(query, { limit: limit + 1 });
        for (const hit of hits) {
          for (const value of fuzzyCandidates.get(hit.item)!) {
            const literal = literalScore(value, query);
            if (literal === null || (!this.includePaths && literal === 20)) matched++;
            else {
              const previous = ranked.findIndex((item) => item.value === value);
              if (previous !== -1) ranked.splice(previous, 1);
            }
            insert(ranked, { value, score: (pathQuery ? 30 : 10) + (hit.score ?? 0) }, limit + 1);
          }
        }
      }
    }
    const result = {
      entries: ranked.slice(0, limit).map(({ value }) => value.entry),
      truncated: matched > limit,
    };
    this.recent.set(cacheKey, result);
    if (this.recent.size > 16) this.recent.delete(this.recent.keys().next().value!);
    return result;
  }
}
