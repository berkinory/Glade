import { parsePatchFiles } from "@pierre/diffs";
import type { FileDiffMetadata } from "@pierre/diffs/react";

export type FileDiffStat = { additions: number; deletions: number };

const DIFF_THEME_NAMES = {
  light: "github-light",
  dark: "github-dark",
} as const;

export type DiffThemeName = (typeof DIFF_THEME_NAMES)[keyof typeof DIFF_THEME_NAMES];

export function resolveDiffThemeName(theme: "light" | "dark"): DiffThemeName {
  return theme === "dark" ? DIFF_THEME_NAMES.dark : DIFF_THEME_NAMES.light;
}

const diffPanelUnsafeCssCache = new Map<"light" | "dark", string>();

export function buildDiffPanelUnsafeCSS(theme: "light" | "dark"): string {
  const cached = diffPanelUnsafeCssCache.get(theme);
  if (cached) {
    return cached;
  }
  const css = `
:host {
  /* Route diff hunks through the chat code font; keep file headers on the UI stack. */
  --diffs-font-family: var(--font-chat-code-family);
  --diffs-header-font-family: var(--font-ui-family);
  /* Honor the user-chosen chat code font size from settings instead of the library default (13px). */
  --diffs-font-size: var(--app-font-size-chat-code, 11px);
  /* Match the app chrome — set on :host so hunk rows/gutters/separators inherit. */
  --diffs-bg: var(--background) !important;
  --diffs-light-bg: var(--background) !important;
  --diffs-dark-bg: var(--background) !important;
  --diffs-token-light-bg: transparent;
  --diffs-token-dark-bg: transparent;

  --diffs-bg-context-override: var(--background) !important;
  --diffs-bg-context-number-override: var(--background) !important;
  --diffs-bg-hover-override: color-mix(in srgb, var(--background) 96%, var(--foreground)) !important;
  --diffs-bg-separator-override: color-mix(in srgb, var(--background) 95%, var(--foreground)) !important;
  --diffs-bg-buffer-override: color-mix(in srgb, var(--background) 92%, var(--foreground)) !important;

  --diffs-bg-addition-override: color-mix(in srgb, var(--background) 92%, var(--success)) !important;
  --diffs-bg-addition-number-override: color-mix(in srgb, var(--background) 88%, var(--success)) !important;
  --diffs-bg-addition-hover-override: color-mix(in srgb, var(--background) 85%, var(--success)) !important;
  --diffs-bg-addition-emphasis-override: color-mix(in srgb, var(--background) 80%, var(--success)) !important;

  --diffs-bg-deletion-override: color-mix(in srgb, var(--background) 92%, var(--destructive)) !important;
  --diffs-bg-deletion-number-override: color-mix(in srgb, var(--background) 88%, var(--destructive)) !important;
  --diffs-bg-deletion-hover-override: color-mix(in srgb, var(--background) 85%, var(--destructive)) !important;
  --diffs-bg-deletion-emphasis-override: color-mix(
    in srgb,
    var(--background) 80%,
    var(--destructive)
  ) !important;

  /* Force the derived tokens Pierre reads for hunk rows (not only the *-override knobs).
     Do not pin --diffs-line-bg on :host — addition/deletion rows set that per line-type. */
  --diffs-bg-context: var(--background) !important;
  --diffs-bg-context-number: var(--background) !important;
  --diffs-bg-buffer: color-mix(in srgb, var(--background) 92%, var(--foreground)) !important;
  --diffs-bg-separator: color-mix(in srgb, var(--background) 95%, var(--foreground)) !important;
  --diffs-bg-addition: color-mix(in srgb, var(--background) 92%, var(--success)) !important;
  --diffs-bg-addition-number: color-mix(in srgb, var(--background) 88%, var(--success)) !important;
  --diffs-bg-addition-hover: color-mix(in srgb, var(--background) 85%, var(--success)) !important;
  --diffs-bg-addition-emphasis: color-mix(in srgb, var(--background) 80%, var(--success)) !important;
  --diffs-bg-deletion: color-mix(in srgb, var(--background) 92%, var(--destructive)) !important;
  --diffs-bg-deletion-number: color-mix(in srgb, var(--background) 88%, var(--destructive)) !important;
  --diffs-bg-deletion-hover: color-mix(in srgb, var(--background) 85%, var(--destructive)) !important;
  --diffs-bg-deletion-emphasis: color-mix(in srgb, var(--background) 80%, var(--destructive)) !important;

  font-family: var(--font-chat-code-family) !important;
  font-size: var(--app-font-size-chat-code, 11px) !important;
  background-color: var(--background) !important;
}

[data-diffs-header],
[data-diff],
[data-file],
[data-error-wrapper],
[data-virtualizer-buffer] {
  --diffs-font-size: var(--app-font-size-chat-code, 11px) !important;
  --diffs-bg: var(--background) !important;
  --diffs-light-bg: var(--background) !important;
  --diffs-dark-bg: var(--background) !important;
  --diffs-bg-context: var(--background) !important;
  --diffs-bg-context-number: var(--background) !important;
  background-color: var(--background) !important;
}

/* Unmodified hunk chrome — pin to theme background without wiping +/- tints. */
[data-line-type="context"],
[data-line-type="context-expanded"],
[data-column-number]:where([data-line-type="context"], [data-line-type="context-expanded"]),
[data-gutter-buffer="buffer"],
[data-separator],
[data-separator-wrapper],
[data-separator-content] {
  --diffs-line-bg: var(--background) !important;
  background-color: var(--background) !important;
}

[data-diff],
[data-file],
[data-error-wrapper],
[data-virtualizer-buffer] {
  /* Re-assert the code font inside diff hunks because these nodes live in shadow-rooted markup. */
  --diffs-font-family: var(--font-chat-code-family) !important;
  font-family: var(--font-chat-code-family) !important;
  font-size: var(--app-font-size-chat-code, 11px) !important;
}

[data-file-info] {
  font-family: var(--font-ui-family) !important;
  font-size: var(--app-font-size-ui, 12px) !important;
  background-color: var(--background) !important;
  border-block-color: var(--border) !important;
  color: var(--foreground) !important;
}

/* Sticky header chrome. Layout for the custom slot only — do not zero-out
   Pierre's default header padding (that clips path/+N text). */
[data-diffs-header] {
  --diffs-header-font-family: var(--font-ui-family) !important;
  font-family: var(--font-ui-family) !important;
  font-size: var(--app-font-size-ui, 12px) !important;
  position: sticky !important;
  top: 0;
  z-index: 4;
  background-color: var(--background) !important;
  border-bottom: 1px solid var(--border) !important;
  cursor: pointer;
}

[data-diffs-header="custom"] {
  display: flex !important;
  align-items: center !important;
  min-height: 0 !important;
  padding: 0 !important;
}

::slotted([slot="header-custom"]) {
  display: flex !important;
  width: 100% !important;
  min-width: 0 !important;
  flex: 1 1 auto !important;
}

/* Give gutters a little air so line numbers aren't clipped by the card edge. */
[data-column-number] {
  padding-left: 1.25ch !important;
}

/* Every number rendered inside a diff reads in the UI font (with tabular figures
   so columns still line up), not the mono code font: gutter line numbers and the
   "N unmodified lines" separators. The library pins these to --diffs-font-family
   from the hunk body, so each needs an explicit override. */
[data-line-number-content],
[data-column-number],
[data-unmodified-lines] {
  font-family: var(--font-ui-family) !important;
  font-variant-numeric: tabular-nums !important;
}

/* Keep the editor's search controls still as the match count changes. */
[data-search-panel] [data-matches] {
  width: 16ch;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
`;
  diffPanelUnsafeCssCache.set(theme, css);
  return css;
}

const FNV_OFFSET_BASIS_32 = 0x811c9dc5;
const FNV_PRIME_32 = 0x01000193;
const SECONDARY_HASH_SEED = 0x9e3779b9;
const SECONDARY_HASH_MULTIPLIER = 0x85ebca6b;

export function fnv1a32(
  input: string,
  seed = FNV_OFFSET_BASIS_32,
  multiplier = FNV_PRIME_32,
): number {
  let hash = seed >>> 0;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, multiplier) >>> 0;
  }
  return hash >>> 0;
}

function buildPatchCacheKey(patch: string, scope = "diff-panel"): string {
  const normalizedPatch = patch.trim();
  const primary = fnv1a32(normalizedPatch, FNV_OFFSET_BASIS_32, FNV_PRIME_32).toString(36);
  const secondary = fnv1a32(
    normalizedPatch,
    SECONDARY_HASH_SEED,
    SECONDARY_HASH_MULTIPLIER,
  ).toString(36);
  return `${scope}:${normalizedPatch.length}:${primary}:${secondary}`;
}

export type RenderablePatch =
  | {
      kind: "files";
      files: FileDiffMetadata[];
    }
  | {
      kind: "raw";
      text: string;
      reason: string;
    };

const PATCH_FILE_BOUNDARY_PATTERN = /^diff --git /gm;

function splitPatchIntoFileSegments(patch: string): string[] {
  const boundaries: number[] = [];
  for (const match of patch.matchAll(PATCH_FILE_BOUNDARY_PATTERN)) {
    boundaries.push(match.index);
  }
  if (boundaries.length <= 1) {
    return [patch];
  }
  const segments: string[] = [];
  let start = 0;
  for (const boundary of boundaries.slice(1)) {
    segments.push(patch.slice(start, boundary));
    start = boundary;
  }
  segments.push(patch.slice(start));
  return segments;
}

export function getRenderablePatch(
  patch: string | undefined,
  cacheScope = "diff-panel",
): RenderablePatch | null {
  if (!patch) return null;
  const normalizedPatch = patch.trim();
  if (normalizedPatch.length === 0) return null;

  try {
    const files = splitPatchIntoFileSegments(normalizedPatch).flatMap((segment) =>
      parsePatchFiles(segment, buildPatchCacheKey(segment, cacheScope)).flatMap(
        (parsedPatch) => parsedPatch.files,
      ),
    );
    if (files.length > 0) {
      return { kind: "files", files };
    }

    return {
      kind: "raw",
      text: normalizedPatch,
      reason: "Unsupported diff format. Showing raw patch.",
    };
  } catch {
    return {
      kind: "raw",
      text: normalizedPatch,
      reason: "Failed to parse patch. Showing raw patch.",
    };
  }
}

export function resolveFileDiffPath(fileDiff: FileDiffMetadata): string {
  const raw = fileDiff.name ?? fileDiff.prevName ?? "";
  if (raw.startsWith("a/") || raw.startsWith("b/")) {
    return raw.slice(2);
  }
  return raw;
}

export function resolveFileDiffPrevPath(fileDiff: FileDiffMetadata): string | null {
  if (
    fileDiff.prevName === undefined ||
    (fileDiff.type !== "rename-pure" && fileDiff.type !== "rename-changed")
  ) {
    return null;
  }
  const raw = fileDiff.prevName;
  if (raw.startsWith("a/") || raw.startsWith("b/")) {
    return raw.slice(2);
  }
  return raw;
}

const UNEDITABLE_GIT_MODES = new Set(["120000", "160000"]);

export function hasUneditableGitMode(fileDiff: FileDiffMetadata): boolean {
  return UNEDITABLE_GIT_MODES.has(fileDiff.mode ?? fileDiff.prevMode ?? "");
}

export function buildFileDiffRenderKey(fileDiff: FileDiffMetadata): string {
  return fileDiff.cacheKey ?? `${fileDiff.prevName ?? "none"}:${fileDiff.name}`;
}

export function splitRepoRelativePath(path: string): { dir: string; name: string } {
  const index = path.lastIndexOf("/");
  if (index === -1) {
    return { dir: "", name: path };
  }
  return { dir: path.slice(0, index + 1), name: path.slice(index + 1) };
}

let diffPathCollator: Intl.Collator | undefined;

function compareDiffPaths(left: string, right: string): number {
  diffPathCollator ??= new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  return diffPathCollator.compare(left, right);
}

function compareFileDiffByPath(left: FileDiffMetadata, right: FileDiffMetadata): number {
  return compareDiffPaths(resolveFileDiffPath(left), resolveFileDiffPath(right));
}

export function sortFileDiffsByPath(files: ReadonlyArray<FileDiffMetadata>): FileDiffMetadata[] {
  return files.toSorted(compareFileDiffByPath);
}

export function summarizeFileDiffStats(files: ReadonlyArray<FileDiffMetadata>): {
  additions: number;
  deletions: number;
} {
  return files.reduce(
    (total, file) => {
      for (const hunk of file.hunks) {
        total.additions += hunk.additionLines;
        total.deletions += hunk.deletionLines;
      }
      return total;
    },
    { additions: 0, deletions: 0 },
  );
}

export function summarizeRenderablePatchStats(
  renderable: RenderablePatch | null | undefined,
): { additions: number; deletions: number; fileCount: number } | null {
  if (!renderable || renderable.kind !== "files" || renderable.files.length === 0) {
    return null;
  }
  return { ...summarizeFileDiffStats(renderable.files), fileCount: renderable.files.length };
}

export function fileDiffStatsByPath(patch: string | undefined): Map<string, FileDiffStat> {
  const stats = new Map<string, FileDiffStat>();
  const renderable = getRenderablePatch(patch, "tool-row:stats");
  if (!renderable || renderable.kind !== "files") {
    return stats;
  }
  for (const file of renderable.files) {
    const path = resolveFileDiffPath(file);
    if (path.length === 0) {
      continue;
    }
    stats.set(path, summarizeFileDiffStats([file]));
  }
  return stats;
}

function normalizeDiffStatPath(path: string): string {
  return path
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/\/+/g, "/");
}

function diffStatPathsReferToSameFile(left: string, right: string): boolean {
  const normalizedLeft = normalizeDiffStatPath(left);
  const normalizedRight = normalizeDiffStatPath(right);
  return (
    normalizedLeft === normalizedRight ||
    normalizedLeft.endsWith(`/${normalizedRight}`) ||
    normalizedRight.endsWith(`/${normalizedLeft}`)
  );
}

export function resolveDiffEntryByPath<T>(
  entriesByPath: ReadonlyMap<string, T>,
  changedFilePath: string,
): T | undefined {
  const direct = entriesByPath.get(changedFilePath);
  if (direct) {
    return direct;
  }

  const matches = Array.from(entriesByPath.entries())
    .filter(([path]) => diffStatPathsReferToSameFile(path, changedFilePath))
    .map(([, entry]) => entry);
  return matches.length === 1 ? matches.at(0) : undefined;
}

export function resolveFileDiffStatByChangedPath(
  statsByPath: ReadonlyMap<string, FileDiffStat>,
  changedFilePath: string,
  changedFileCount: number,
): FileDiffStat | undefined {
  if (statsByPath.size === 0) {
    return undefined;
  }

  const match = resolveDiffEntryByPath(statsByPath, changedFilePath);
  if (match) {
    return match;
  }

  if (statsByPath.size === 1 && changedFileCount === 1) {
    return statsByPath.values().next().value;
  }
  return undefined;
}
