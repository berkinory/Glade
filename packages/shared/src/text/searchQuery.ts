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

/**
 * Case-insensitive search key shared by chat search on the client and the server. Dotted and
 * dotless I (i, ı, I, İ) count as one letter so Turkish text matches however the letter is typed.
 */
export function foldSearchText(value: string): string {
  return value.toLowerCase().replaceAll("i̇", "i").replaceAll("ı", "i");
}
