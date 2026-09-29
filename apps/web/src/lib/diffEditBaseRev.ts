import type { RepoDiffScope } from "~/repoDiffScopeStore";

export type DiffEditBaseScope = RepoDiffScope;

export type DiffEditBaseRev = { rev: string } | { base: "branch" | "index" };

export type DiffFileEditMode = "diff" | "file";

export interface DiffFileEditRequest {
  filePath: string;

  basePath?: string | undefined;
  mode: DiffFileEditMode;
  baseRev: DiffEditBaseRev;
}

export function resolveDiffEditBaseRev(
  scope: DiffEditBaseScope,
  compareRef: string | null,
): DiffEditBaseRev {
  if (scope === "ref") {
    const trimmedRef = compareRef?.trim() ?? "";
    return trimmedRef.length > 0 ? { rev: trimmedRef } : { rev: "HEAD" };
  }
  if (scope === "branch") {
    return { base: "branch" };
  }
  if (scope === "unstaged") {
    return { base: "index" };
  }
  return { rev: "HEAD" };
}

export function resolveDiffFileEditMode(
  viewKind: "repo" | "turn",
  scope: DiffEditBaseScope,
): DiffFileEditMode {
  return viewKind === "turn" || scope === "staged" ? "file" : "diff";
}
