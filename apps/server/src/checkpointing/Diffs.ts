import type { OrchestrationCheckpointFile } from "@glade/contracts/orchestration/threadEntities";
import { Effect } from "effect";

import { lazyModule } from "../platform/lazyModule.ts";

type PierreDiffsModule = typeof import("@pierre/diffs");
type ParsedPatches = ReturnType<PierreDiffsModule["parsePatchFiles"]>;

const loadPatchParser = lazyModule(() =>
  import("@pierre/diffs").then(({ parsePatchFiles }) => parsePatchFiles),
);

function checkpointKindFromParsedFile(
  type: ParsedPatches[number]["files"][number]["type"],
): string {
  switch (type) {
    case "deleted":
      return "deleted";
    case "new":
      return "added";
    case "rename-pure":
    case "rename-changed":
      return "renamed";
    case "change":
      return "modified";
  }
}

function summarizeParsedPatches(parsedPatches: ParsedPatches): OrchestrationCheckpointFile[] {
  const filesByPath = new Map<string, OrchestrationCheckpointFile>();
  for (const patch of parsedPatches) {
    for (const file of patch.files) {
      const additions = file.hunks.reduce((total, hunk) => total + hunk.additionLines, 0);
      const deletions = file.hunks.reduce((total, hunk) => total + hunk.deletionLines, 0);
      const existing = filesByPath.get(file.name);
      filesByPath.set(file.name, {
        path: file.name,
        kind: checkpointKindFromParsedFile(file.type),
        additions: (existing?.additions ?? 0) + additions,
        deletions: (existing?.deletions ?? 0) + deletions,
      });
    }
  }

  return Array.from(filesByPath.values()).toSorted((left, right) =>
    left.path.localeCompare(right.path),
  );
}

// Effectful because the diff parser is imported lazily. A malformed patch still surfaces as a
// defect, exactly as it did when the parser was a static import.
export function parseCheckpointFilesFromUnifiedDiff(
  diff: string,
): Effect.Effect<OrchestrationCheckpointFile[]> {
  return Effect.suspend(() => {
    const normalized = diff.replace(/\r\n/g, "\n").trim();
    if (normalized.length === 0) {
      return Effect.succeed<OrchestrationCheckpointFile[]>([]);
    }
    return Effect.map(
      Effect.promise(() => loadPatchParser()),
      (parsePatchFiles) => summarizeParsedPatches(parsePatchFiles(normalized)),
    );
  });
}

function checkpointKindFromRawStatus(status: string): string {
  switch (status.charAt(0)) {
    case "A":
    case "C":
      return "added";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    default:
      return "modified";
  }
}

const parseNumstatCount = (value: string | undefined) => {
  const count = Number.parseInt(value ?? "", 10);
  return Number.isFinite(count) && count >= 0 ? count : 0;
};

// Parses `git diff --raw --numstat -z`: every raw record (`:modes oids status\0path\0[dst\0]`)
// precedes the numstat records (`adds\tdels\tpath\0`, or `adds\tdels\t\0src\0dst\0` for renames
// and copies). Binary files report `-` counts and summarize as zero lines.
export function parseCheckpointFilesFromRawNumstat(output: string): OrchestrationCheckpointFile[] {
  const tokens = output.split("\0");
  const kindByPath = new Map<string, string>();
  const countsByPath = new Map<string, { additions: number; deletions: number }>();
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index++] ?? "";
    if (token.length === 0) continue;
    if (token.startsWith(":")) {
      const status = token.slice(token.lastIndexOf(" ") + 1);
      if (status.startsWith("R") || status.startsWith("C")) index += 1;
      const path = tokens[index++];
      if (path) kindByPath.set(path, checkpointKindFromRawStatus(status));
      continue;
    }
    const [additions, deletions, inlinePath = ""] = token.split("\t");
    let path = inlinePath;
    if (path.length === 0) {
      path = tokens[index + 1] ?? "";
      index += 2;
    }
    if (!path) continue;
    const existing = countsByPath.get(path);
    countsByPath.set(path, {
      additions: (existing?.additions ?? 0) + parseNumstatCount(additions),
      deletions: (existing?.deletions ?? 0) + parseNumstatCount(deletions),
    });
  }

  return Array.from(kindByPath, ([path, kind]) => ({
    path,
    kind,
    additions: countsByPath.get(path)?.additions ?? 0,
    deletions: countsByPath.get(path)?.deletions ?? 0,
  })).toSorted((left, right) => left.path.localeCompare(right.path));
}
