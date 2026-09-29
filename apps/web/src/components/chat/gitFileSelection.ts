import type { SourceFile } from "./GitFileList";

export type GitFileSectionId = "staged" | "unstaged";

export interface GitFileSelection {
  section: GitFileSectionId;
  paths: readonly string[];
  anchor: string;
}

export function selectGitFiles(input: {
  current: GitFileSelection | null;
  section: GitFileSectionId;
  files: readonly SourceFile[];
  path: string;
  additive: boolean;
  range: boolean;
}): GitFileSelection {
  const { current, section, files, path, additive, range } = input;
  const sameSection = current?.section === section;
  if (range && sameSection) {
    const anchorIndex = files.findIndex((file) => file.path === current.anchor);
    const targetIndex = files.findIndex((file) => file.path === path);
    if (anchorIndex >= 0 && targetIndex >= 0) {
      const rangePaths = files
        .slice(Math.min(anchorIndex, targetIndex), Math.max(anchorIndex, targetIndex) + 1)
        .map((file) => file.path);
      return {
        section,
        paths: additive ? [...new Set([...current.paths, ...rangePaths])] : rangePaths,
        anchor: current.anchor,
      };
    }
  }
  if (additive && sameSection) {
    const paths = current.paths.includes(path)
      ? current.paths.filter((selected) => selected !== path)
      : [...current.paths, path];
    return { section, paths, anchor: path };
  }
  return { section, paths: [path], anchor: path };
}
