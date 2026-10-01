export function normalizeWorkspaceEntrySearchQuery(input: string): string {
  return input
    .trim()
    .replace(/^[@./]+/, "")
    .toLowerCase();
}

export interface ContentSearchOptions {
  matchCase?: boolean | undefined;
  wholeWord?: boolean | undefined;
}

export function createContentSearchPattern(
  query: string,
  options: ContentSearchOptions = {},
): RegExp {
  const literal = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const source = options.wholeWord ? `(?<![\\p{L}\\p{N}_])${literal}(?![\\p{L}\\p{N}_])` : literal;
  return new RegExp(source, options.matchCase ? "gu" : "giu");
}
