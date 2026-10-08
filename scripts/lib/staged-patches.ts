import { readFileSync } from "node:fs";
import { join } from "node:path";

interface PatchFileExpectation {
  readonly file: string;
  readonly addedLines: ReadonlyArray<string>;
}

function parsePatchAddedLines(patchContents: string): PatchFileExpectation[] {
  const expectations: Array<{ file: string; addedLines: string[] }> = [];
  let current: { file: string; addedLines: string[] } | null = null;
  for (const line of patchContents.split("\n")) {
    if (line.startsWith("+++ ")) {
      const target = line.slice(4).trim();
      if (target === "/dev/null") {
        current = null;
        continue;
      }
      current = { file: target.startsWith("b/") ? target.slice(2) : target, addedLines: [] };
      expectations.push(current);
      continue;
    }
    if (current && line.startsWith("+")) {
      const added = line.slice(1).trim();
      if (added.length > 0) {
        current.addedLines.push(added);
      }
    }
  }
  return expectations.filter((expectation) => expectation.addedLines.length > 0);
}

// Returns why a tracked patch is missing from a staged install, or null when every patch applied.
// Patched packages that the stage does not install are skipped.
export function findUnappliedStagedPatch(input: {
  readonly repoRoot: string;
  readonly stageDir: string;
  readonly patchedDependencies: Readonly<Record<string, string>>;
  readonly requireInstalled: boolean;
}): string | null {
  for (const [dependency, patchRelativePath] of Object.entries(input.patchedDependencies)) {
    const packageName = dependency.slice(0, dependency.indexOf("@", 1));
    const patchContents = readFileSync(join(input.repoRoot, patchRelativePath), "utf8");
    for (const expectation of parsePatchAddedLines(patchContents)) {
      const stagedFilePath = join(input.stageDir, "node_modules", packageName, expectation.file);
      let stagedContents: string;
      try {
        stagedContents = readFileSync(stagedFilePath, "utf8");
      } catch {
        if (!input.requireInstalled) break;
        return `Patched dependency file is missing from the stage: ${stagedFilePath} (expected by ${patchRelativePath}).`;
      }
      for (const addedLine of expectation.addedLines) {
        if (!stagedContents.includes(addedLine)) {
          return `Staged dependency ${packageName} is missing patched content: ${expectation.file} does not contain "${addedLine}" from ${patchRelativePath}. The tracked patch was not applied by the staged install.`;
        }
      }
    }
  }
  return null;
}
