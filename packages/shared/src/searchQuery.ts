// FILE: searchQuery.ts
// Purpose: Shared literal content matching and normalization for workspace ENTRY (file/directory name)
//          search queries. The server ranker and the web match highlighter must
//          agree on what counts as the query — when they drift, a result can
//          match server-side while the client renders it with no emphasis
//          (e.g. typing "./comp" for Composer.tsx).
// Layer: Shared runtime utility
// Exports: normalizeWorkspaceEntrySearchQuery, createContentSearchPattern, ContentSearchOptions
//
// Scope note: entry normalization is specific to name search. Content search
// does not strip prefixes, and local filesystem search has its own dotfile
// semantics — neither should adopt this normalizer.

/**
 * Trims, strips leading "@" / "." / "/" prefixes (mention syntax and relative
 * path noise), and lowercases.
 */
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

/** Literal search with Unicode word boundaries; shared by scanning and highlighting. */
export function createContentSearchPattern(
  query: string,
  options: ContentSearchOptions = {},
): RegExp {
  const literal = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const source = options.wholeWord ? `(?<![\\p{L}\\p{N}_])${literal}(?![\\p{L}\\p{N}_])` : literal;
  return new RegExp(source, options.matchCase ? "gu" : "giu");
}
