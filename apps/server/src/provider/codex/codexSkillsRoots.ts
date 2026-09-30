import { statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export function codexExtraSkillsRoots(input: {
  readonly cwd: string | undefined;
  readonly gladeSkillsDir: string | undefined;
}): string[] {
  const roots = new Set<string>();
  const addExistingDirectory = (candidate: string) => {
    try {
      if (statSync(candidate, { throwIfNoEntry: false })?.isDirectory()) {
        roots.add(candidate);
      }
    } catch {
      // A skills root that cannot be read should not prevent Codex from starting.
    }
  };

  if (input.gladeSkillsDir) addExistingDirectory(path.resolve(input.gladeSkillsDir));

  const home = path.resolve(homedir());
  const scopes = new Set<string>([home]);
  if (input.cwd) {
    let current = path.resolve(input.cwd);
    for (;;) {
      scopes.add(current);
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }

  for (const scope of scopes) {
    addExistingDirectory(path.join(scope, ".claude", "skills"));
    addExistingDirectory(path.join(scope, ".agents", "skills"));
  }
  return [...roots];
}
